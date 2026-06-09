import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Store contributed spots in-memory to survive the active session
interface ContributedSpot {
  id: string;
  name: string;
  type: "on-street" | "off-street";
  latitude: number;
  longitude: number;
  address: string;
  costInfo: string;
  timeLimit: string;
  weekdaysRule: string;
  weekendsRule: string;
  vacancyProbability: number;
  proximityScore: number;
  aiReasoning: string;
  suburb?: string;
}

const contributedSpots: ContributedSpot[] = [];

// Geodistance calculation (Haversine formula) to filter crowdsourced spots
function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // radius of Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function mergeContributedSpots(spots: any[], targetLat: number, targetLng: number, suburbName: string) {
  const matching = contributedSpots.filter((spot) => {
    const isClose = getDistanceKm(targetLat, targetLng, spot.latitude, spot.longitude) <= 3.5;
    const isSameSuburb = !!(spot.suburb && spot.suburb.toLowerCase().includes(suburbName.toLowerCase()));
    return isClose || isSameSuburb;
  });

  const existingIds = new Set(spots.map((s) => s.id));
  const newSpots = [...spots];

  matching.forEach((m) => {
    if (!existingIds.has(m.id)) {
      newSpots.push({
        ...m,
        proximityScore: Math.min(100, Math.max(20, Math.round(100 - getDistanceKm(targetLat, targetLng, m.latitude, m.longitude) * 20)))
      });
    }
  });

  return newSpots;
}

// Initialize GenAI client lazily to avoid startup crashes if key is invalid/missing
let aiClient: GoogleGenAI | null = null;
let aiInitialized = false;

function getAiClient(): GoogleGenAI | null {
  if (!aiInitialized) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey.trim() !== "") {
      try {
        aiClient = new GoogleGenAI({
          apiKey: apiKey.trim(),
          httpOptions: {
            headers: {
              "User-Agent": "aistudio-build",
            },
          },
        });
        console.log("Gemini AI API client lazy-initialized successfully.");
      } catch (err) {
        console.error("Failed to initialize GoogleGenAI client:", err);
        aiClient = null;
      }
    } else {
      console.log("No GEMINI_API_KEY found or configured. Running in simulation mode.");
      aiClient = null;
    }
    aiInitialized = true;
  }
  return aiClient;
}

// Nominatim Geocoder Route
app.get("/api/geocode", async (req, res) => {
  const query = req.query.q as string;
  if (!query) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "FreeParkingFinderApplet/1.0 (Jessedmaslen@gmail.com)",
      },
    });

    if (!response.ok) {
      throw new Error(`Nominatim returned status ${response.status}`);
    }

    const data = await response.json();
    return res.json(data);
  } catch (error: any) {
    console.error("Geocoding error:", error);
    // Return a dummy geocode match centered in Sydney/San Francisco if it fails
    // to keep the app working gracefully
    return res.json([
      {
        display_name: `${query} (Offline Mode Simulation)`,
        lat: "-33.8688",
        lon: "151.2093",
        importance: 0.5,
      },
    ]);
  }
});

// Helper to generate simulation search spots if AI key is missing or fails
function getSimulationSpots(suburb: string, lat: number, lng: number) {
  const names = [
    {
      name: `${suburb} Library civic carpark`,
      type: "off-street" as const,
      offsetLat: -0.0012,
      offsetLng: 0.0018,
      address: "12 Civic Way",
      costInfo: "Free (First 2 hours)",
      timeLimit: "2P",
      weekdaysRule: "Free 2P 8am-6pm. Unlimited free overnight.",
      weekendsRule: "Free Saturday 8am-12pm. Unlimited free Sunday.",
      vacancyProbability: 65,
      proximityScore: 92,
      aiReasoning: "Excellent local library facility. Highly vacant on weekday mornings; some civic parking is unrestricted after-hours.",
    },
    {
      name: `${suburb} Shopping Arcade ground deck`,
      type: "off-street" as const,
      offsetLat: 0.0021,
      offsetLng: -0.0015,
      address: "88 Retail Blvd",
      costInfo: "Free (First 3 hours)",
      timeLimit: "3P",
      weekdaysRule: "Free first 3 hours, then hourly charges apply.",
      weekendsRule: "Free first 3 hours. Great option for premium weekend visual storage.",
      vacancyProbability: 40,
      proximityScore: 85,
      aiReasoning: "A covered retail structure offering safe visual shelter. Excellent security, though congestion runs high during weekday lunches.",
    },
    {
      name: "Belmore Reserve parking strip",
      type: "off-street" as const,
      offsetLat: -0.0035,
      offsetLng: -0.0028,
      address: "Parkside Crescent (adjacent to playground)",
      costInfo: "Free Unlimited",
      timeLimit: "Unlimited",
      weekdaysRule: "No restrictions. Always green.",
      weekendsRule: "Unrestricted, but fills up quickly during sporting fixtures.",
      vacancyProbability: 80,
      proximityScore: 70,
      aiReasoning: "A scenic recreational parking lot with zero time caps. Perfect choice for commuter car sharing or full-day stays.",
    },
    {
      name: "Victoria Street Parking Bay",
      type: "on-street" as const,
      offsetLat: 0.0008,
      offsetLng: 0.0034,
      address: "102-140 Victoria St",
      costInfo: "Free",
      timeLimit: "1P",
      weekdaysRule: "Free 1P 9am-5:30pm. Unlimited free after 6pm.",
      weekendsRule: "Free weekend stays, no limits.",
      vacancyProbability: 55,
      proximityScore: 95,
      aiReasoning: "Highly central on-street bays. High turn-over due to 1-hour limits, resulting in a higher instant vacancy check.",
    },
    {
      name: "Albion Lane residential zone",
      type: "on-street" as const,
      offsetLat: -0.0022,
      offsetLng: 0.0005,
      address: "Albion Lane & Crown Street",
      costInfo: "Free (Unrestricted)",
      timeLimit: "Unlimited",
      weekdaysRule: "Free all day. Excludes residential-permit bays.",
      weekendsRule: "Totally free. No restrictions.",
      vacancyProbability: 30,
      proximityScore: 88,
      aiReasoning: "Hidden back-lane with quiet residential flow. Watch for permit signposts, but non-permit bays are 100% free with great shade.",
    },
    {
      name: "Railway Commuter Carpark",
      type: "off-street" as const,
      offsetLat: 0.0045,
      offsetLng: 0.0022,
      address: "Station Road Interchange",
      costInfo: "Free",
      timeLimit: "Unlimited",
      weekdaysRule: "Free for rail patrons (requires local transport card tap validation).",
      weekendsRule: "Open to general public, 100% free with high vacancy.",
      vacancyProbability: 90,
      proximityScore: 60,
      aiReasoning: "Perfect transit hub. Extremely vacant on weekends, highly secure with high surveillance.",
    }
  ];

  return names.map((spot, index) => ({
    id: `sim-spot-${index + 1}`,
    name: spot.name,
    type: spot.type,
    latitude: lat + spot.offsetLat,
    longitude: lng + spot.offsetLng,
    address: spot.address,
    costInfo: spot.costInfo,
    timeLimit: spot.timeLimit,
    weekdaysRule: spot.weekdaysRule,
    weekendsRule: spot.weekendsRule,
    vacancyProbability: spot.vacancyProbability,
    proximityScore: spot.proximityScore,
    aiReasoning: spot.aiReasoning,
  }));
}

// Search Parking Spots Route
app.get("/api/parking", async (req, res) => {
  const suburb = (req.query.suburb as string) || "Fitzroy";
  const userLatStr = req.query.lat as string;
  const userLngStr = req.query.lng as string;

  let lat = userLatStr ? parseFloat(userLatStr) : -33.8688;
  let lng = userLngStr ? parseFloat(userLngStr) : 151.2093;

  const ai = getAiClient();

  try {
    // If we have an AI client, fetch real web-grounded recommendations
    if (ai) {
      try {
        console.log(`Querying Gemini AI with search grounding for: ${suburb}`);
        
        const promptText = `Find real or highly realistic free off-street and street parking locations in or extremely close to the suburb: "${suburb}". 
The suburb's geographical centre is approximately Latitude: ${lat}, Longitude: ${lng}.
Please identify 6 to 9 of the best free parking spots (on-street bays, library parking, transit hubs, civic centres, shoppers lots with free parking limits, residential pockets with no restriction signs).
You should supply exact geographical coordinates (latitude and longitude) that represent real-world streets/structures near "${suburb}" around lat ${lat} and lng ${lng}.
For each spot, rank its proximity to the suburb's high-st center (proximityScore 0 to 100, where 100 is extremely close/central) and vacancy probability (0 to 100%) based on parking styles.

IMPORTANT: Your response MUST be valid JSON and return ONLY the JSON object. Do not wrap it in Markdown markers or triple backticks, or if you do, ensure it parses as standard clean JSON.
Adhere strictly to this JSON structure:
{
  "suburb": "${suburb}",
  "spots": [
    {
      "id": "ai-spot-1",
      "name": "Specific street section name or Carpark Name",
      "type": "on-street" or "off-street",
      "latitude": -33.8688,
      "longitude": 151.2093,
      "address": "Street address or corner intersection",
      "costInfo": "Free (e.g. Free 2P, First 2 hours, or Unlimited)",
      "timeLimit": "e.g. 2P, 1P, 15m, Unlimited",
      "weekdaysRule": "Weekday restrictions explanation (e.g. 2P 8:30am-6pm, other times unrestricted)",
      "weekendsRule": "Weekend rules (e.g. Saturday 2P, Sunday Free & Unrestricted)",
      "vacancyProbability": 70,
      "proximityScore": 90,
      "aiReasoning": "Short, expert AI tip about why this is a prime spot, any hidden signs, parking inspectors presence, or convenient shortcuts."
    }
  ]
}`;

        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: promptText,
          config: {
            responseMimeType: "application/json",
            tools: [{ googleSearch: {} }], // Ground search results with active google search to find authentic parking guides
          },
        });

        const parsedText = response.text || "";
        try {
          const cleanedText = parsedText.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
          const aiResponse = JSON.parse(cleanedText);

          if (aiResponse && Array.isArray(aiResponse.spots)) {
            console.log(`Successfully returned ${aiResponse.spots.length} AI grounded spots.`);
            const rawSpots = aiResponse.spots.map((s: any, idx: number) => ({
              ...s,
              id: s.id || `ai-spot-${idx + 1}`,
              latitude: Number(s.latitude || lat),
              longitude: Number(s.longitude || lng),
            }));
            const mergedSpots = mergeContributedSpots(rawSpots, lat, lng, suburb);
            return res.json({
              suburb,
              location: {
                name: suburb,
                latitude: lat,
                longitude: lng,
              },
              spots: mergedSpots,
              searchSource: "ai",
            });
          }
        } catch (parseErr) {
          console.error("Failed to parse Gemini output as JSON, returning simulation spots", parseErr, parsedText);
        }
      } catch (geminiErr: any) {
        // Intercept Gemini API errors (e.g. RESOURCE_EXHAUSTED / 429 quota limits or bad API key)
        const errMsg = geminiErr?.message || String(geminiErr);
        const isQuota = errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("quota") || geminiErr?.status === 429;
        
        if (isQuota) {
          console.warn(`[Gemini API] Quota/rate limit reached for "${suburb}". Quietly falling back to realistic local simulation.`);
        } else {
          console.error(`[Gemini API] Error calling model for "${suburb}":`, geminiErr);
        }
        // Let it naturally fall through to getSimulationSpots below
      }
    }

    // Default simulation fallback (or when GEMINI_API_KEY is not defined)
    const simulatedSpots = getSimulationSpots(suburb, lat, lng);
    const mergedSpots = mergeContributedSpots(simulatedSpots, lat, lng, suburb);
    return res.json({
      suburb,
      location: {
        name: suburb,
        latitude: lat,
        longitude: lng,
      },
      spots: mergedSpots,
      searchSource: "simulation",
    });

  } catch (error: any) {
    const errMsg = error?.message || String(error);
    const isQuota = errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("quota") || error?.status === 429;

    if (isQuota) {
      console.warn(`[Gemini API] Quota/rate limit reached on outer handler for "${suburb}". Quietly falling back to simulation data.`);
    } else {
      console.error("General API Error in parking route:", error);
    }

    const simulatedSpots = getSimulationSpots(suburb, lat, lng);
    const mergedSpots = mergeContributedSpots(simulatedSpots, lat, lng, suburb);
    return res.json({
      suburb,
      location: {
        name: suburb,
        latitude: lat,
        longitude: lng,
      },
      spots: mergedSpots,
      searchSource: "simulation",
      error: error.message || "An error occurred retrieving AI data.",
    });
  }
});

// Endpoint to contribute a new free parking spot/street data
app.post("/api/parking/contribute", (req, res) => {
  const {
    name,
    type,
    latitude,
    longitude,
    address,
    costInfo,
    timeLimit,
    weekdaysRule,
    weekendsRule,
    vacancyProbability,
    aiReasoning,
    suburb
  } = req.body;

  if (!name || isNaN(parseFloat(latitude)) || isNaN(parseFloat(longitude)) || !address) {
    return res.status(400).json({ error: "Missing or invalid required fields (name, latitude, longitude, address)." });
  }

  const newSpot = {
    id: `contributed-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: String(name),
    type: type === "off-street" ? "off-street" as const : "on-street" as const,
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    address: String(address),
    costInfo: String(costInfo || "Free"),
    timeLimit: String(timeLimit || "Unlimited"),
    weekdaysRule: String(weekdaysRule || "Free & Unrestricted"),
    weekendsRule: String(weekendsRule || "Free & Unrestricted"),
    vacancyProbability: isNaN(parseInt(vacancyProbability)) ? 75 : Math.max(0, Math.min(100, parseInt(vacancyProbability))),
    proximityScore: 90,
    aiReasoning: String(aiReasoning || "Local crowdsourced spot reported with love by neighborhood driver."),
    suburb: suburb ? String(suburb) : undefined
  };

  contributedSpots.push(newSpot);
  console.log(`[Custom Spot Creator] New free space registered: "${newSpot.name}" at ${newSpot.address}`);
  return res.status(201).json(newSpot);
});

// Setup Vite & Static Files asset delivery
async function startServer() {
  const isProduction = process.env.NODE_ENV === "production" || 
                       (typeof __filename !== "undefined" && __filename.includes("dist")) || 
                       (import.meta && import.meta.url && import.meta.url.includes("dist"));

  if (!isProduction) {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("Vite development server loaded successfully.");
    } catch (err) {
      console.warn("Could not load Vite development server, falling back to static production router:", err);
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  } else {
    console.log("Starting server in PRODUCTION mode (serving static files from dist).");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    if (!process.env.GEMINI_API_KEY) {
      console.log("Note: GEMINI_API_KEY environment variable is not set. Live simulation is active.");
    } else {
      console.log("GEMINI_API_KEY is configured.");
    }
  });
}

startServer();
