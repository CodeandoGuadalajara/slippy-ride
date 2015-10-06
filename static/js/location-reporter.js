var socket;
var myUserName;
var markers = {};
var busMarkers = {};
var radiusMarker;
var searchRadius = 1000;
var isSimulator = false;
var map;

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
				case 'new-user-location':
					if(evtData.data.lat && evtData.data.lng){
						createMarker(evtData.data.userName, evtData.data.lat, evtData.data.lng, true);
					} else {
						console.log("Could not get location", evtData.data);
					}
				break;
				
				case 'updated-user-location':
					if (myUserName != evtData.data.userName){
						if (markers[evtData.data.userName] == null){
							if(evtData.data.lat && evtData.data.lng){
								createMarker(evtData.data.userName, evtData.data.lat, evtData.data.lng, true);
							} else {
								console.log("Could not get location", evtData.data);
							}
						} else {
							if(evtData.data.lat && evtData.data.lng){
								markers[evtData.data.userName].setPosition(new google.maps.LatLng(evtData.data.lat, evtData.data.lng));
							} else {
								console.log("Could not update location", evtData.evtData.data);
							}
						}
					}
				break;
				
				case 'remove-user-marker':
					if (myUserName != evtData.data.userName && evtData.data.userName != null){
						removeUserMarker(evtData.data.userName);
					}
				break;
				
				case 'new-bus-location':
					console.log("new-bus");
					if(evtData.data.lat && evtData.data.lng){
						//console.log(evtData.data);
						createBusMarker(evtData.data.id, evtData.data.routeNumber, evtData.data.lat, evtData.data.lng, false);
					} else {
						console.log("Could not get location", evtData.data);
					}
				break;
				
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
				
				case 'remove-bus-marker':
					if (busMarkers[evtData.data.id] != null){
						removeBusMarker(evtData.data.id);
					}
				break;
			}
		}
	}
}

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

function sendPosition(position){
	if (!socket) {
           return false;
    }
	var newPosition = {"event": "new-bus-location", "data": {"lat": position.lat(), "lng": position.lng()}};
	socket.send(JSON.stringify(newPosition));
}

function removeUserMarker(userName){
	// Remove from map and delete
	markers[userName].setMap(null);
	markers[userName] = null;
}

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


function positionSuccess(position) {
	//console.log("Got position");
	var lat = position.coords.latitude;
	var lng = position.coords.longitude;
	var acr = position.coords.accuracy;
	
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

function createMarker(userName, lat, lng, showInfowindow){
	
	var userLocation = new google.maps.LatLng(lat,lng);
	
	var contentString = "<b>" + userName + "</b>";
								//"<b>Latitud:</b> " + lat + "<br>" +
								//"<b>Longitud:</b>" + lng;
	var infowindow = new google.maps.InfoWindow({
		content: contentString
	});
	//console.log("Usuario " + userName);
	
	var image;
	var isDraggable;
	
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

	google.maps.event.addListener(marker, 'click', function() {
    infowindow.open(map,marker);
  });
  
	if (showInfowindow){
		infowindow.open(map, marker);
	}
	
	google.maps.event.addListener(marker, 'drag', function() {
		// Broadcast new position and update radius marker
		var newPosition = {"event": "updated-user-location", "data": {"userName": myUserName, "lat": this.getPosition().lat(), "lng": this.getPosition().lng()}};
		socket.send(JSON.stringify(newPosition));
		
		radiusMarker.setCenter(this.getPosition());
	});
	
	google.maps.event.addListener(marker, 'dragend', function() {
		busMarkers = deleteOutOfBoundsMarkers(busMarkers, this.getPosition(), searchRadius);
	});
}

// Check if marker is within the bounds of search radius
function isWithinBounds(queryPoint, referencePoint, radius){
	var withinBounds = false;
	var distanceToUser = google.maps.geometry.spherical.computeDistanceBetween(queryPoint, referencePoint);
	if (distanceToUser <= radius){
		withinBounds = true;
	}
	
	return withinBounds;
}

// Delete out of bounds bus markers
function deleteOutOfBoundsMarkers(inputMarkers, referencePoint, searchRadius){
	var outputMarkers = {};
	for (var key in inputMarkers){
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

// handle geolocation api errors
function positionError(error) {
	//console.log("No location");
	var errors = {
		1: "Authorization fails", // permission denied
		2: "Can\'t detect your location", //position unavailable
		3: "Connection timeout" // timeout
	};
	console.log("Error:" + errors[error.code]);
}

window.onbeforeunload = cleanupAndExit;

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

function stopSimulation(){
	for (var key in busMarkers) {
       if (busMarkers.hasOwnProperty(key)) {
        	// Emit removal event
        	var simulationStopper = {"event": "remove-bus-marker", "data": {"id": key}};
			socket.send(JSON.stringify(simulationStopper));
       }
    }
}

function removeBusMarker(id){
	// Remove from map and delete
	if (!! busMarkers[id]){
		busMarkers[id].setMap(null);
		busMarkers[id] = null;
	}
	
	delete busMarkers[id];
}



function createBusMarker(id, routeNumber, lat, lng, showInfowindow){
	
	var busLocation = new google.maps.LatLng(lat,lng);
	
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
	
	busMarkers[id] = marker;
	
	google.maps.event.addListener(marker, 'click', function() {
    	infowindow.open(map,marker);
	});
  
	if (showInfowindow){
		infowindow.open(map, marker);
	}
}