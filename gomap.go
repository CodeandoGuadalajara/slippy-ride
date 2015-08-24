/*
	Package Main is the entry point for the gomap program.
*/
package main

import (
	"flag"
	"github.com/gorilla/websocket"
	"html/template"
	"log"
	"net/http"
	"path/filepath"
	"regexp"
	"encoding/json"
	_ "github.com/lib/pq"
	"database/sql"
	"fmt"
	"github.com/satori/go.uuid"
)

var dbConn *sql.DB

func dbConnect() *sql.DB {
	// Create connection
	db, err := sql.Open("postgres", "user=webapp host=localhost dbname=Gaia password=PG4pp! sslmode=disable")
	if err != nil {
		panic(err)
	}
	return db
}

// Type hub represents the structure of a websockets connection hub.
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

// Create a new connections hub.
func newHub() *hub {
	return &hub{
		broadcast:   make(chan []byte),
		register:    make(chan *connection),
		unregister:  make(chan *connection),
		connections: make(map[string]*connection),
	}
}

// Run the connections hub.
func (h *hub) run() {
	
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
			if m != nil{
				
				// Read JSON data and check if we require a selective broadcast
				var jsonData map[string]interface{}
				if err := json.Unmarshal(m, &jsonData); err != nil {		       
					panic(err)
			    }
				
				// new-bus-location requires selective broadcast
				if jsonData["event"] == "updated-bus-location"{
					
					// Get message data
					data := jsonData["data"].(map[string]interface{})
					
					// Query users to broadcast to based on location
					query := fmt.Sprint("SELECT id_connection FROM sleipnir.users_location WHERE ST_DWITHIN(geography, ST_GeomFromText('POINT(", data["lng"], " ", data["lat"], ")',4326), 1000);")
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
			
					for id,c := range h.connections {
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

// Reader parses the message passed through the websocket and broadcasts it.
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

func getEventResponse(jsonMessage []byte, connectionID string) []byte {
	
	var eventResponse []byte
	var err error
	
	// Read JSON data
	var jsonData map[string]interface{}
	if err := json.Unmarshal(jsonMessage, &jsonData); err != nil {
        panic(err)
    }
	
	// Check the event name and act accordingly
	switch jsonData["event"]{
		
		// User arrived, register in db
		case "new-user-location":
			
			// Define query and execute as goroutine
			data := jsonData["data"].(map[string]interface{})
			
			query := fmt.Sprint("INSERT INTO sleipnir.users_location (name, status, id_connection, geography) VALUES ('", data["userName"], "', 1, '", connectionID, "', ST_GeomFromText('POINT(", data["lng"], " ", data["lat"], ")',4326));")
			go executeQuery(dbConn,query)
						
			eventResponse = jsonMessage
			err = nil

		break;
		
		// User changed position, update in db
		case "updated-user-location":
			
			// Define query and execute as goroutine
			data := jsonData["data"].(map[string]interface{})
			
			query := fmt.Sprint("UPDATE sleipnir.users_location SET name = '", data["userName"], "', status=1, geography = ST_GeomFromText('POINT(", data["lng"], " ", data["lat"], ")',4326) WHERE id_connection = '", connectionID, "';")
			go executeQuery(dbConn,query)
						
			eventResponse = jsonMessage
			err = nil

		break;
		
		// User left, cleanup
		case "user-left":
			
			// Send cleanup marker event
			jsonData["event"] = "remove-user-marker"
			
			query := fmt.Sprint("DELETE FROM sleipnir.users_location WHERE id_connection = '", connectionID, "';")
			go executeQuery(dbConn,query)
			
			// Marshall JSON
			eventResponse, err = json.Marshal(jsonData)

		break;
		
		// New bus location, check if users are close by to report location
		case "new-bus-location":
			
			//data := jsonData["data"].(map[string]interface{})
			
			//query := fmt.Sprint("DELETE FROM sleipnir.users_location WHERE name = '", data["userName"], "';")
			//go executeQuery(dbConn,query)

		break;
		
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

func executeQuery(dbConn *sql.DB, query string){
	
	_, err := dbConn.Exec(query)
	
	if err != nil{
		fmt.Println(err)
	}
}

// Writer sends data through the websocket.
func (c *connection) writer() {
	for message := range c.send {
		err := c.ws.WriteMessage(websocket.TextMessage, message)
		if err != nil {
			break
		}
	}
	c.ws.Close()
}

// Upgrader creates a websocket connection by upgrading an ordinary http connection.
var upgrader = &websocket.Upgrader{ReadBufferSize: 1024, WriteBufferSize: 1024}

// wsHandler represents a WebSocket handler.
type wsHandler struct {
	h *hub
}

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

// Initial variables
var (
	addr      = flag.String("addr", ":8080", "http service address")
	//assets    = flag.String("assets", defaultAssetPath(), "path to assets")
	homeTempl *template.Template
	routesTempl *template.Template
)

// homeHandler serves the home template when accessing the root endpoint
func homeHandler(c http.ResponseWriter, req *http.Request) {
	homeTempl.Execute(c, req.Host)
}

// routeSimulatorHandler serves the home template when accessing the root endpoint
func routeSimulatorHandler(c http.ResponseWriter, req *http.Request) {
	routesTempl.Execute(c, req.Host)
}

// Parse template files one time, then render them when needed with templates.ExecuteTemplate
var templates = template.Must(template.ParseFiles("map.html", "routes.html"))

// Restrict valid paths to edit, save or view endpoints
var validPath = regexp.MustCompile("^/(gomap)/([a-zA-Z0-9]+)$")


// View endpoint handler, loads the page body and renders the appropriate template
func viewHandler(w http.ResponseWriter, r *http.Request, title string) {
	renderTemplate(w, "map")
}

// Template rendering function
func renderTemplate(w http.ResponseWriter, tmpl string) {
	err := templates.ExecuteTemplate(w, tmpl+".html", nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// Main entry point
func main() {
	
	// Connect to DB
	dbConn = dbConnect()
	defer dbConn.Close()
	
	// Parse initial flags
	flag.Parse()
	
	// Define home template and hub
	homeTempl = template.Must(template.ParseFiles(filepath.Join("/home/otto/Devel/go/src/github.com/marakame/gomap", "map.html")))
	routesTempl = template.Must(template.ParseFiles(filepath.Join("/home/otto/Devel/go/src/github.com/marakame/gomap", "routes.html")))
	h := newHub()
	
	// Run hub concurrently
	go h.run()
	
	// Define handlers
	http.HandleFunc("/", homeHandler)
	http.Handle("/ws", wsHandler{h: h})
	http.Handle("/routes/ws", wsHandler{h: h})
	http.HandleFunc("/routes/", routeSimulatorHandler)
	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("/home/otto/Devel/go/src/github.com/marakame/gomap/static/"))))
	
	// Start server
	if err := http.ListenAndServe(*addr, nil); err != nil {
		log.Fatal("ListenAndServe:", err)
	}
}