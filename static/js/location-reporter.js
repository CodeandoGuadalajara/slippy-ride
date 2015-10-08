var socket;
var myUserName;
var markers = {};
var busMarkers = {};
var radiusMarker;
var searchRadius = 1000;
var isSimulator = false;
var map;

/**
 * Initializes the web socket with all the events definitions
 */
function initializeSocket(){
	if (window["WebSocket"]) {
		socket = new WebSocket(getUri());
		console.log(getUri());
       	socket.onclose = function(evt) {
       	    console.log("Connection closed.");
       	}
       	
		socket.onmessage = function(evt) {
       		
			var evtData = JSON.parse(evt.data);    
			
			switch (evtData.event){
				
				// When a user arrives a marker is created
				case 'new-user-location':
					if(evtData.data.lat && evtData.data.lng){
						createUserMarker(evtData.data.userName, evtData.data.lat, evtData.data.lng, true);
					} else {
						console.log("Could not get location", evtData.data);
					}
				break;
				
				// When a user updates their location, the corresponding marker is updated as well
				case 'updated-user-location':
					// Check that it's not me
					if (myUserName != evtData.data.userName){
						
						// If there's no marker, create it
						if (markers[evtData.data.userName] == null){
							if(evtData.data.lat && evtData.data.lng){
								createUserMarker(evtData.data.userName, evtData.data.lat, evtData.data.lng, true);
							} else {
								console.log("Could not get location", evtData.data);
							}
						// Or just update
						} else {
							if(evtData.data.lat && evtData.data.lng){
								markers[evtData.data.userName].setPosition(new google.maps.LatLng(evtData.data.lat, evtData.data.lng));
							} else {
								console.log("Could not update location", evtData.evtData.data);
							}
						}
					}
				break;
				
				// Remove user marker, usually after a user exits the application
				case 'remove-user-marker':
					if (myUserName != evtData.data.userName && evtData.data.userName != null){
						removeUserMarker(evtData.data.userName);
					}
				break;
				
				// A new bus means a new bus marker
				case 'new-bus-location':
					if(evtData.data.lat && evtData.data.lng){
						//console.log(evtData.data);
						createBusMarker(evtData.data.id, evtData.data.routeNumber, evtData.data.lat, evtData.data.lng, false);
					} else {
						console.log("Could not get location", evtData.data);
					}
				break;
				
				// When an update to a bus location is reported, update the marker with the required distance validations
				case 'updated-bus-location':
					if (busMarkers[evtData.data.id] == null){
						if(evtData.data.lat && evtData.data.lng){
							//console.log(evtData.data);
							
							// Check if it's within the bounds of search radius
							var busLocation = new google.maps.LatLng(evtData.data.lat,evtData.data.lng);
							if (markers[myUserName] != null){
							
								// A radius of 0 means no limit
								if (searchRadius != 0){
									if (isWithinBounds(busLocation, markers[myUserName].getPosition(), searchRadius)){
										createBusMarker(evtData.data.id, evtData.data.routeNumber, evtData.data.lat, evtData.data.lng, false);
									}
								} else {
									createBusMarker(evtData.data.id, evtData.data.routeNumber, evtData.data.lat, evtData.data.lng, false);
								}
							}
						} else {
							console.log("Could not get location", evtData.data);
						}
					} else {
						if(evtData.data.lat && evtData.data.lng){
							
							// Check if it's within the bounds of search radius
							var busLocation = new google.maps.LatLng(evtData.data.lat,evtData.data.lng);
							if (markers[myUserName] != null){
								// A radius of 0 means no limit
								if (searchRadius != 0){
									if (!isWithinBounds(busLocation, markers[myUserName].getPosition(), searchRadius)){
										removeBusMarker(evtData.data.id);
									} else {
										busMarkers[evtData.data.id].setPosition(new google.maps.LatLng(evtData.data.lat, evtData.data.lng));
									}
								} else {
									busMarkers[evtData.data.id].setPosition(new google.maps.LatLng(evtData.data.lat, evtData.data.lng));
								}
							}
						
						} else {
							console.log("Could not update location", evtData.data);
						}
					}
				break;
				
				// Delete a bus marker
				case 'remove-bus-marker':
					if (busMarkers[evtData.data.id] != null){
						removeBusMarker(evtData.data.id);
					}
				break;
			}
		}
	}
}

/**
 * Returns the web socket URI based on the protocol used to access the application (http or https)
 * @returns {string} The properly formatted URI.
 */
function getUri(){
	var loc = window.location, new_uri;
	if (loc.protocol === "https:") {
	    new_uri = "wss:";
	} else {
	    new_uri = "ws:";
	}
	new_uri += "//" + loc.host;
	new_uri += loc.pathname + "ws";
	
	return new_uri
}

/**
 * Queries the position of the user to the browser
 * @param {requestCallback} positionSucces - The callback that handles the position query success response.
 * @param {requestCallback} positionError - The callback that handles the position query error response.
 */
function getBrowserGeolocation(){
	//console.log("Geolocation start.");
	// check whether browser supports geolocation api
	if (navigator.geolocation) {
		//console.log("Navigator gelocation");
		navigator.geolocation.getCurrentPosition(positionSuccess, positionError,{ enableHighAccuracy: true });
	} else {
		//console.log("No navigator gelocation");
		alert("El navegadror no cuenta con funciones de geolocalización, intente actualizar a la versión más actual.");
	}
}

/**
 * Handles the browser's successful position query. Basically it emits
 * the position to all connected users and creates the search radius marker.
 * @param {Object} position - The position of the user as provided by the browser.
 */
function positionSuccess(position) {
	//console.log("Got position");
	var lat = position.coords.latitude;
	var lng = position.coords.longitude;
	var acr = position.coords.accuracy;
	
	// Emit event with current position and name
	var newPosition = {"event": "new-user-location", "data": {"userName": myUserName, "searchRadius": parseInt(searchRadius), "lat": lat, "lng": lng}};
	socket.send(JSON.stringify(newPosition));
	
	// Create radius indicator
	radiusMarker = new google.maps.Circle({
		strokeColor: '#FF0000',
		strokeOpacity: 0.8,
		strokeWeight: 2,
		fillColor: '#FF0000',
		fillOpacity: 0.11,
		map: map,
		center: new google.maps.LatLng(lat,lng),
		radius: parseInt(searchRadius)
	});
	//console.log("Report emmited");
}

// handle geolocation api errors
/**
 * Handles the browser's error on the position query.
 * @param {Object} error - The error returned by the browser.
 */
function positionError(error) {
	//console.log("No location");
	var errors = {
		1: "Authorization fails", // permission denied
		2: "Can\'t detect your location", //position unavailable
		3: "Connection timeout" // timeout
	};
	console.log("Error:" + errors[error.code]);
}

/**
 * Creates a user marker with it's corresponding properties and events
 * @param {string} userName - The name of the user associated with the marker.
 * @param {number} lat - The latitude of the user's position.
 * @param {number} lng - The longitude of the user's position.
 * @param {Boolean} showInfowindow - If set to true, the new marker will open it's infowindow immediately after it's creation.
 */
function createUserMarker(userName, lat, lng, showInfowindow){
	
	var userLocation = new google.maps.LatLng(lat,lng);
	
	// Infowindow contents
	var contentString = "<b>" + userName + "</b>";
								//"<b>Latitud:</b> " + lat + "<br>" +
								//"<b>Longitud:</b>" + lng;
	var infowindow = new google.maps.InfoWindow({
		content: contentString
	});
	//console.log("Usuario " + userName);
	
	var image;
	var isDraggable;
	
	// If it's my marker it will be draggable
	if (myUserName == userName){
		image = '/static/images/red-dot.png';
		isDraggable = true;
	} else {
		image = '/static/images/blue-dot.png';
		isDraggable = false;
	}
	var marker = new google.maps.Marker({
			position: userLocation,
			animation: google.maps.Animation.DROP,
			draggable: isDraggable,
			icon: image,
			map: map,
			title: userName
		});
		
	markers[userName] = marker;

	// Set the on click listener to open the infowindow
	google.maps.event.addListener(marker, 'click', function() {
		infowindow.open(map,marker);
	});
	
	if (showInfowindow){
		infowindow.open(map, marker);
	}
	
	// On drag broadcast new position and update radius marker
	google.maps.event.addListener(marker, 'drag', function() {
		var newPosition = {"event": "updated-user-location", "data": {"userName": myUserName, "lat": this.getPosition().lat(), "lng": this.getPosition().lng()}};
		socket.send(JSON.stringify(newPosition));
		
		radiusMarker.setCenter(this.getPosition());
	});
	
	google.maps.event.addListener(marker, 'dragend', function() {
		busMarkers = deleteOutOfBoundsMarkers(busMarkers, this.getPosition(), searchRadius);
	});
}

/**
 * Creates a bus marker with it's corresponding properties and events
 * @param {string} id - The id of the bus associated with the marker.
 * @param {string} routeNumber - The user known route number string of the bus associated with the marker.
 * @param {number} lat - The latitude of the user's position.
 * @param {number} lng - The longitude of the user's position.
 * @param {Boolean} showInfowindow - If set to true, the new marker will open it's infowindow immediately after it's creation.
 */
function createBusMarker(id, routeNumber, lat, lng, showInfowindow){
	
	var busLocation = new google.maps.LatLng(lat,lng);
	
	// The markers infowindow
	var contentString = "<b>" + routeNumber + "</b>";
								//"<b>Latitud:</b> " + lat + "<br>" +
								//"<b>Longitud:</b>" + lng;
	var infowindow = new google.maps.InfoWindow({
		content: contentString
	});
	//console.log("Usuario " + userName);
	
	var image;
	var isDraggable;
		
	var image = new google.maps.MarkerImage(
		'/static/images/bus.png',
		null, // size is determined at runtime
		null, // origin is 0,0
		null, // anchor is bottom center of the scaled image
 		new google.maps.Size(24, 24)
	);
	isDraggable = false;
	
	var marker = new google.maps.Marker({
			position: busLocation,
			draggable: isDraggable,
			icon: image,
			map: map,
			title: routeNumber
		});
	
	// Add it to the bus markers array
	busMarkers[id] = marker;
	
	// Add a click listener to show the infowindow
	google.maps.event.addListener(marker, 'click', function() {
    	infowindow.open(map,marker);
	});
	
	// Show immediately if requested
	if (showInfowindow){
		infowindow.open(map, marker);
	}
}

/**
 * Removes a user marker from the map
 * @param {string} userName - The name of the user to remove.
 */
function removeUserMarker(userName){
	// Remove from map and delete
	markers[userName].setMap(null);
	markers[userName] = null;
}

/**
 * Removes a bus marker from the map
 * @param {string} id - The id of the bus to remove.
 */
function removeBusMarker(id){
	// Remove from map and delete
	if (!! busMarkers[id]){
		busMarkers[id].setMap(null);
		busMarkers[id] = null;
	}
	
	delete busMarkers[id];
}

/**
 * Check if a marker is within the bounds of a search radius
 * @param {Object} queryPoint - A google latlng object with the position to compare with the search radius.
 * @param {Object} referencePoint - The point used as reference for the radius, typically, the user's position.
 * @param {number} radius - The radius of interest to search.
 * @returns {Boolean} True if querypoint is within the radius, false otherwise.
 */
function isWithinBounds(queryPoint, referencePoint, radius){
	var withinBounds = false;
	var distanceToUser = google.maps.geometry.spherical.computeDistanceBetween(queryPoint, referencePoint);
	if (distanceToUser <= radius){
		withinBounds = true;
	}
	
	return withinBounds;
}

/**
 * Deletes all the markers from a markers JSON array if they're outside an specified radius.
 * @param {Object[]} inputMarkers - The markers JSON array.
 * @param {Object} referencePoint - The point used as reference for the radius, typically, the user's position.
 * @param {number} searchRadius - The radius of interest to search.
 * @returns {Object[]} A new JSON array with the markers within the search radius.
 */
function deleteOutOfBoundsMarkers(inputMarkers, referencePoint, searchRadius){
	var outputMarkers = {};
	for (var key in inputMarkers){
		// If it's not empty check if it's within the specified radius to
		// include it or delete it from the JSON
		if (!! inputMarkers[key]){
			if (isWithinBounds(inputMarkers[key].getPosition(), referencePoint, searchRadius)){
				outputMarkers[key] = inputMarkers[key];
			} else {
				inputMarkers[key].setMap(null);
				delete inputMarkers[key];
			}
		} else {
			inputMarkers.splice(key,1);
		}
	}
	
	return outputMarkers;
}

window.onbeforeunload = cleanupAndExit;

/**
 * Ends the current session taking appropriate actions.
 * If the session is a user session it will emit the user-left event to remove
 * the user from the other users map, and if it's a simulator session, it will
 * stop the simulation. Finally the web socket used for communications will be closed.
 */
function cleanupAndExit(){
	
	// If user is reporting location stop
	if (myUserName != null){
		var userDeletion = {"event": "user-left", "data": { "userName": myUserName}};
		socket.send(JSON.stringify(userDeletion));
	} 
	
	// Check if is simulator then delete buses
	if (isSimulator){
		stopSimulation();
	}
	
	socket.close();
}

/**
 * Removes all the buses from all users maps by emitting the remove-bus-marker event
 * for every remaining bus.
 */
function stopSimulation(){
	for (var key in busMarkers) {
       if (busMarkers.hasOwnProperty(key)) {
        	// Emit removal event
        	var simulationStopper = {"event": "remove-bus-marker", "data": {"id": key}};
			socket.send(JSON.stringify(simulationStopper));
       }
    }
}