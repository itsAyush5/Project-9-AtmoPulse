from flask import Flask, render_template, jsonify, request
import requests
import webbrowser
import threading
import time
import os

app = Flask(__name__)

# --- CONFIGURATION ---
# Get your token from https://aqicn.org/data-platform/token/
WAQI_TOKEN = os.environ.get("WAQI_TOKEN", "587df79d4f5fc40d6632e23d8a2e16ca3d7cf816") 
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
WAQI_BASE_URL = "https://api.waqi.info"

HEADERS = {
    "User-Agent": "AtmosphereAQIMonitor/3.0 (contact: help@atmosphere-aqi.io)"
}

# Initial cities for the dashboard
CITIES = [
    {"name": "New York", "lat": 40.7128, "lon": -74.0060},
    {"name": "London", "lat": 51.5074, "lon": -0.1278},
    {"name": "Tokyo", "lat": 35.6895, "lon": 139.6917},
    {"name": "Paris", "lat": 48.8566, "lon": 2.3522},
    {"name": "Beijing", "lat": 39.9042, "lon": 116.4074},
    {"name": "New Delhi", "lat": 28.6139, "lon": 77.2090},
    {"name": "Sydney", "lat": -33.8688, "lon": 151.2093},
    {"name": "Sao Paulo", "lat": -23.5505, "lon": -46.6333},
    {"name": "Cairo", "lat": 30.0444, "lon": 31.2357},
    {"name": "Moscow", "lat": 55.7558, "lon": 37.6173},
    {"name": "Mumbai", "lat": 19.0760, "lon": 72.8777},
    {"name": "Dubai", "lat": 25.2048, "lon": 55.2708},
    {"name": "Singapore", "lat": 1.3521, "lon": 103.8198},
    {"name": "Istanbul", "lat": 41.0082, "lon": 28.9784},
    {"name": "Seoul", "lat": 37.5665, "lon": 126.9780},
    {"name": "Berlin", "lat": 52.5200, "lon": 13.4050}
]

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/aqi')
def get_aqi():
    """Fetches AQI for the initial set of global cities using station search."""
    results = []
    
    def fetch_city_data(city):
        try:
            # First, search for the best station in that city
            search_url = f"{WAQI_BASE_URL}/search/?keyword={city['name']}&token={WAQI_TOKEN}"
            search_res = requests.get(search_url, timeout=10)
            search_data = search_res.json()
            
            if search_data["status"] == "ok" and search_data["data"]:
                # Get the first station's UID
                uid = search_data["data"][0]["uid"]
                # Fetch detailed feed for this specific station
                feed_url = f"{WAQI_BASE_URL}/feed/@{uid}/?token={WAQI_TOKEN}"
                feed_res = requests.get(feed_url, timeout=10)
                feed_data = feed_res.json()
                
                if feed_data["status"] == "ok":
                    data = feed_data["data"]
                    iaqi = data.get("iaqi", {})
                    results.append({
                        "name": city["name"],
                        "lat": city["lat"],
                        "lon": city["lon"],
                        "aqi": data["aqi"],
                        "details": {
                            "pm2_5": iaqi.get("pm25", {}).get("v"),
                            "pm10": iaqi.get("pm10", {}).get("v"),
                            "ozone": iaqi.get("o3", {}).get("v"),
                            "nitrogen_dioxide": iaqi.get("no2", {}).get("v"),
                            "carbon_monoxide": iaqi.get("co", {}).get("v"),
                            "sulphur_dioxide": iaqi.get("so2", {}).get("v")
                        }
                    })
        except Exception as e:
            print(f"Error fetching data for {city['name']}: {e}")

    # Use threads to speed up the initial load
    threads = []
    for city in CITIES:
        t = threading.Thread(target=fetch_city_data, args=(city,))
        t.start()
        threads.append(t)
    
    for t in threads:
        t.join()
        
    return jsonify(results)

@app.route('/api/search')
def search_location():
    query = request.args.get('q')
    if not query:
        return jsonify({"error": "No query provided"}), 400
        
    try:
        # Step 1: Geocoding via Nominatim (for Map position)
        geo_params = {"q": query, "format": "json", "limit": 1, "addressdetails": 1}
        geo_res = requests.get(NOMINATIM_URL, params=geo_params, headers=HEADERS, timeout=5)
        geo_res.raise_for_status()
        geo_data = geo_res.json()
        
        if not geo_data:
            return jsonify({"error": "Location not found"}), 404
            
        location = geo_data[0]
        lat = float(location["lat"])
        lon = float(location["lon"])
        display_name = location.get("display_name", query)
        
        # Step 2: Fetch AQI via WAQI Search (to get real station data)
        # Search by keyword or by coordinates if it's a specific coordinate string
        search_query = f"{lat};{lon}" if query.replace('.','',1).replace('-','',1).replace(';','',1).isdigit() else query
        search_url = f"{WAQI_BASE_URL}/search/?keyword={query}&token={WAQI_TOKEN}"
        search_res = requests.get(search_url, timeout=10)
        search_data = search_res.json()

        if search_data["status"] == "ok" and search_data["data"]:
            # Use the most relevant station
            uid = search_data["data"][0]["uid"]
            feed_url = f"{WAQI_BASE_URL}/feed/@{uid}/?token={WAQI_TOKEN}"
            aqi_res = requests.get(feed_url, timeout=10)
            aqi_data = aqi_res.json()
            
            if aqi_data["status"] == "ok":
                data = aqi_data["data"]
                iaqi = data.get("iaqi", {})
                
                return jsonify({
                    "name": display_name,
                    "lat": lat,
                    "lon": lon,
                    "aqi": data["aqi"],
                    "details": {
                        "pm2_5": iaqi.get("pm25", {}).get("v"),
                        "pm10": iaqi.get("pm10", {}).get("v"),
                        "ozone": iaqi.get("o3", {}).get("v"),
                        "nitrogen_dioxide": iaqi.get("no2", {}).get("v"),
                        "carbon_monoxide": iaqi.get("co", {}).get("v"),
                        "sulphur_dioxide": iaqi.get("so2", {}).get("v")
                    }
                })
        
        return jsonify({"error": "AQI data unavailable for this location"}), 404
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def open_browser():
    time.sleep(1.5)
    webbrowser.open('http://127.0.0.1:5000')

if __name__ == '__main__':
    threading.Thread(target=open_browser).start()
    app.run(debug=True, port=5000)
