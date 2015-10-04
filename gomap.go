/*
	Package Main is the entry point for the gomap program.
*/
package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/gorilla/websocket"
	_ "github.com/lib/pq"
	"github.com/satori/go.uuid"
	"html/template"
	"log"
	"net/http"
	"path/filepath"
)

// Initial variables.
var (
	// Web server
	addr        = flag.String("addr", ":8080", "http service address")
	homeTempl   *template.Template
	routesTempl *template.Template
	
	// Paths
	basePath 		string = "."
	templatesPath	string = filepath.Join(basePath, "templates")
	httpStaticPath	string = filepath.Join(basePath, "static")

	// DB connection parameters
	dbConn     *sql.DB
	dbHost     string = "localhost"
	dbName     string = "Gaia"
	dbUser     string = "webapp"
	dbPassword string = "PG4pp!"
	dbSslMode  string = "disable"

	// Users table column names
	// No variable is defined for SRID since we are using a geography column type and
	// geography types always use lat/lon 4326
	usersTable                string = "sleipnir.users_location"
	usersTableConnectionId    string = "id_connection"
	usersTableName            string = "name"
	usersTableStatus          string = "status"
	usersTableGeographyColumn string = "geography"
)

// A hub represents the structure of a websockets connection hub.
// It contains a connections map and channels for broadcasting messages,
// registering and unregistering connections.
type hub struct {
	// Registered connections.
	connections map[string]*connection

	// Inbound messages from the connections.
	broadcast chan []byte

	// Register requests from the connections.
	register chan *connection

	// Unregister requests from connections.
	unregister chan *connection
}

// Type connection represents a websockets connection.
// It is conformed of a reference to the websockets connection,
// a buffered channel for data transfer and a reference to the hub.
type connection struct {
	// The websocket connection.
	ws *websocket.Conn

	// Buffered channel of outbound messages.
	send chan []byte

	// The hub.
	h *hub

	// Connection ID
	connectionID string
}

// wsHandler represents a WebSocket handler.
type wsHandler struct {
	h *hub
}

// dbConnect creates the connection to the database using the parameters specified in the Initial variables.
func dbConnect() *sql.DB {
	// Create connection
	db, err := sql.Open("postgres", fmt.Sprintf("host=%s dbname=%s user=%s password=%s sslmode=%s", dbHost, dbName, dbUser, dbPassword, dbSslMode))
	if err != nil {
		panic(err)
	}
	return db
}

// executeQuery runs the database query string passed to it.
func executeQuery(dbConn *sql.DB, query string) {

	_, err := dbConn.Exec(query)

	if err != nil {
		fmt.Println(err)
	}
}

// newHub creates a new connections hub.
func newHub() *hub {
	return &hub{
		broadcast:   make(chan []byte),
		register:    make(chan *connection),
		unregister:  make(chan *connection),
		connections: make(map[string]*connection),
	}
}

// runHub runs the connections hub.
func (h *hub) runHub() {

	// Check each of the channels and act accordingly.
	for {
		select {
		case c := <-h.register:
			h.connections[c.connectionID] = c
		case c := <-h.unregister:
			if _, ok := h.connections[c.connectionID]; ok {
				delete(h.connections, c.connectionID)
				close(c.send)
			}
		// If we have a message iterate through the connections and send the message.
		// It is at this point where we should check to which connections we will be sending data.
		case m := <-h.broadcast:

			// Check that message is not null
			if m != nil {

				// Read JSON data and check if we require a selective broadcast
				var jsonData map[string]interface{}
				if err := json.Unmarshal(m, &jsonData); err != nil {
					panic(err)
				}

				// new-bus-location requires selective broadcast
				if jsonData["event"] == "updated-bus-location" {

					// Get message data
					data := jsonData["data"].(map[string]interface{})

					// Query users to broadcast to based on location
					query := fmt.Sprint("SELECT ", usersTableConnectionId, " FROM ", usersTable, " WHERE ST_DWITHIN(", usersTableGeographyColumn, ", ST_GeomFromText('POINT(", data["lng"], " ", data["lat"], ")',4326), 1000);")
					rows, err := dbConn.Query(query)

					if err != nil {
						fmt.Println(err)
						log.Fatal(err)
					}

					// Broadcast to each of the resulting users
					for rows.Next() {
						var id_connection string
						if err := rows.Scan(&id_connection); err != nil {
							fmt.Println(err)
							log.Fatal(err)
						}
						if c, ok := h.connections[id_connection]; ok {
							c.send <- m
						} else {
							delete(h.connections, id_connection)
							close(c.send)
						}
					}

					// Log errors
					if err := rows.Err(); err != nil {
						log.Fatal(err)
					}

				} else {

					for id, c := range h.connections {
						select {
						case c.send <- m:
						default:
							delete(h.connections, id)
							close(c.send)
						}
					}
				}
			}
		}
	}
}

// reader parses the message passed through the websocket and broadcasts it.
func (c *connection) reader() {
	for {
		_, message, err := c.ws.ReadMessage()
		if err != nil {
			break
		}
		// Run message handler to read the event names and act accordingly
		responseMessage := getEventResponse(message, c.connectionID)

		c.h.broadcast <- responseMessage
	}
	c.ws.Close()
}

// writer sends data through the websocket.
func (c *connection) writer() {
	for message := range c.send {
		err := c.ws.WriteMessage(websocket.TextMessage, message)
		if err != nil {
			break
		}
	}
	c.ws.Close()
}

// getEventResponse reads the event name passed from the reader and generates
// an appropriate response based on it.
func getEventResponse(jsonMessage []byte, connectionID string) []byte {

	var eventResponse []byte
	var err error

	// Read JSON data
	var jsonData map[string]interface{}
	if err := json.Unmarshal(jsonMessage, &jsonData); err != nil {
		panic(err)
	}

	// Check the event name and act accordingly
	switch jsonData["event"] {

	// User arrived, register in db
	case "new-user-location":

		// Define query and execute as goroutine
		data := jsonData["data"].(map[string]interface{})

		query := fmt.Sprint("INSERT INTO ", usersTable, " (", usersTableName, ",", usersTableStatus, ",", usersTableConnectionId, ",", usersTableGeographyColumn, ") VALUES ('", data["userName"], "', 1, '", connectionID, "', ST_GeomFromText('POINT(", data["lng"], " ", data["lat"], ")',4326));")
		go executeQuery(dbConn, query)

		eventResponse = jsonMessage
		err = nil

		break

	// User changed position, update in db
	case "updated-user-location":

		// Define query and execute as goroutine
		data := jsonData["data"].(map[string]interface{})

		query := fmt.Sprint("UPDATE ", usersTable, " SET ", usersTableName, " = '", data["userName"], "', ", usersTableStatus, "=1, ", usersTableGeographyColumn, " = ST_GeomFromText('POINT(", data["lng"], " ", data["lat"], ")',4326) WHERE ", usersTableConnectionId, " = '", connectionID, "';")
		go executeQuery(dbConn, query)
		eventResponse = jsonMessage
		err = nil

		break

	// User left, cleanup
	case "user-left":

		// Send cleanup marker event
		jsonData["event"] = "remove-user-marker"

		query := fmt.Sprint("DELETE FROM ", usersTable, " WHERE ", usersTableConnectionId, "= '", connectionID, "';")
		go executeQuery(dbConn, query)

		// Marshall JSON
		eventResponse, err = json.Marshal(jsonData)

		break

	// New bus location, check if users are close by to report location
	case "new-bus-location":

		//data := jsonData["data"].(map[string]interface{})

		//query := fmt.Sprint("DELETE FROM ", usersTable, " WHERE ", usersTableName, "= '", data["userName"], "';")
		//go executeQuery(dbConn,query)

		break

	default:
		eventResponse = jsonMessage
		err = nil
	}

	if err != nil {
		// TODO: Return error response
		panic(err)
	}

	return eventResponse
}

// upgrader creates a websocket connection by upgrading an ordinary http connection.
var upgrader = &websocket.Upgrader{ReadBufferSize: 1024, WriteBufferSize: 1024}

// ServeHTTP starts http serving.
func (wsh wsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c := &connection{send: make(chan []byte, 256), ws: ws, h: wsh.h, connectionID: uuid.NewV4().String()}
	c.h.register <- c
	defer func() { c.h.unregister <- c }()
	go c.writer()
	c.reader()
}

// homeHandler serves the home template when accessing the root endpoint
func homeHandler(c http.ResponseWriter, req *http.Request) {
	homeTempl.Execute(c, req.Host)
}

// routeSimulatorHandler serves the route simulator template when accessing the /routes endpoint
func routeSimulatorHandler(c http.ResponseWriter, req *http.Request) {
	routesTempl.Execute(c, req.Host)
}

// Main entry point
func main() {

	// Connect to DB
	dbConn = dbConnect()
	defer dbConn.Close()

	// Parse initial flags
	flag.Parse()

	// Define home template and hub
	homeTempl = template.Must(template.ParseFiles(filepath.Join(templatesPath, "map.html")))
	routesTempl = template.Must(template.ParseFiles(filepath.Join(templatesPath, "routes.html")))
	h := newHub()

	// Run hub concurrently
	go h.runHub()

	// Define handlers
	http.HandleFunc("/", homeHandler)
	http.Handle("/ws", wsHandler{h: h})
	http.Handle("/routes/ws", wsHandler{h: h})
	http.HandleFunc("/routes/", routeSimulatorHandler)
	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir(httpStaticPath))))

	// Start server
	if err := http.ListenAndServe(*addr, nil); err != nil {
		log.Fatal("ListenAndServe:", err)
	}
}
