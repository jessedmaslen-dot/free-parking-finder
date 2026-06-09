import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  MapPin,
  Compass,
  Sparkles,
  Clock,
  Coins,
  Star,
  CheckCircle,
  Calendar,
  Navigation,
  RefreshCw,
  AlertCircle,
  Info,
  X,
  ChevronRight,
  Filter,
  MessageSquare,
} from "lucide-react";
import { ParkingSpot, SuburbLocation, ParkingSearchResponse, ParkingReport } from "./types";
import ParkingMap from "./components/ParkingMap";

const PRESET_SUBURBS = [
  { name: "Surry Hills", city: "Sydney", lat: -33.8860, lng: 151.2110 },
  { name: "Fitzroy", city: "Melbourne", lat: -37.8010, lng: 144.9790 },
  { name: "Santa Monica", city: "Los Angeles", lat: 34.0194, lng: -118.4912 },
  { name: "San Francisco", city: "California", lat: 37.7749, lng: -122.4194 },
  { name: "West End", city: "Brisbane", lat: -27.4819, lng: 153.0117 },
  { name: "Richmond", city: "Melbourne", lat: -37.8231, lng: 144.9980 },
];

export default function App() {
  const [searchQuery, setSearchQuery] = useState("");
  const [suburbLabel, setSuburbLabel] = useState("Surry Hills");
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [center, setCenter] = useState<[number, number]>([-33.8860, 151.2110]);
  const [selectedSpot, setSelectedSpot] = useState<ParkingSpot | null>(null);
  const [favorites, setFavorites] = useState<ParkingSpot[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchSource, setSearchSource] = useState<"ai" | "simulation">("simulation");
  const [dayType, setDayType] = useState<"weekday" | "weekend">("weekday");
  const [filterType, setFilterType] = useState<"all" | "on-street" | "off-street">("all");
  const [minVacancy, setMinVacancy] = useState<number>(0);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [geocodingSuggestions, setGeocodingSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: "success" | "info" | "error" } | null>(null);

  // Community reporting state: keeps track of user reports by spot.id
  const [localReports, setLocalReports] = useState<{ [spotId: string]: ParkingReport[] }>(() => {
    const saved = localStorage.getItem("parking_reports");
    return saved ? JSON.parse(saved) : {};
  });

  // State for report creation form
  const [newReportType, setNewReportType] = useState<"free" | "occupied" | "broken" | null>(null);
  const [newReportNote, setNewReportNote] = useState("");
  const [isReporting, setIsReporting] = useState(false);

  const [isAddingCustomSpot, setIsAddingCustomSpot] = useState(false);
  const [isValidatingAddress, setIsValidatingAddress] = useState(false);
  const [customForm, setCustomForm] = useState({
    name: "",
    address: "",
    type: "on-street" as "on-street" | "off-street",
    timeLimit: "",
    weekdaysRule: "",
    weekendsRule: "",
    costInfo: "",
    vacancyProbability: 70,
    aiReasoning: "",
    latitude: null as number | null,
    longitude: null as number | null,
  });

  // Load Favorites from LocalStorage on mount and sync contributed spots
  useEffect(() => {
    const saved = localStorage.getItem("fav_spots");
    if (saved) {
      try {
        setFavorites(JSON.parse(saved));
      } catch (err) {
        console.error("Failed loading favorites", err);
      }
    }

    // Sync localStorage contributed spots to the active server session
    const savedContributedStr = localStorage.getItem("contributed_spots");
    if (savedContributedStr) {
      try {
        const localContribs: ParkingSpot[] = JSON.parse(savedContributedStr);
        localContribs.forEach(async (spot) => {
          try {
            await fetch("/api/parking/contribute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(spot)
            });
          } catch (e) {
            console.error("Local sync of spot failed", e);
          }
        });
      } catch (err) {
        console.error("Failed parsing localStorage spots", err);
      }
    }
    
    // Initial fetch for default suburb
    fetchParkingData("Surry Hills", -33.8860, 151.2110);
  }, []);

  // Save Favorites to LocalStorage when database changes
  const toggleFavorite = (spot: ParkingSpot) => {
    let updated;
    const isAlreadyFav = favorites.some((f) => f.id === spot.id);
    if (isAlreadyFav) {
      updated = favorites.filter((f) => f.id !== spot.id);
      showToast(`Removed "${spot.name}" from your bookmarks`, "info");
    } else {
      updated = [...favorites, { ...spot, isFavorite: true }];
      showToast(`Saved "${spot.name}" for later! 🌟`, "success");
    }
    setFavorites(updated);
    localStorage.setItem("fav_spots", JSON.stringify(updated));
  };

  const showToast = (message: string, type: "success" | "info" | "error") => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  // Autocomplete typing lookup (debounced)
  useEffect(() => {
    if (searchQuery.trim().length < 3) {
      setGeocodingSuggestions([]);
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) {
          const data = await res.json();
          setGeocodingSuggestions(data);
        }
      } catch (err) {
        console.error("Autocomplete fetch error", err);
      }
    }, 450);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery]);

  // Core API caller to fetch parking spots
  const fetchParkingData = async (suburbName: string, lat: number, lon: number) => {
    setIsLoading(true);
    setSelectedSpot(null);
    setSuburbLabel(suburbName);
    try {
      const res = await fetch(`/api/parking?suburb=${encodeURIComponent(suburbName)}&lat=${lat}&lng=${lon}`);
      if (!res.ok) throw new Error("Server responded with error status");
      
      const data: ParkingSearchResponse = await res.json();
      setSpots(data.spots);
      setCenter([lat, lon]);
      setSearchSource(data.searchSource);
      
      if (data.searchSource === "ai") {
        showToast(`AI mapped ${data.spots.length} neighborhood spaces in ${suburbName}! 🌿`, "success");
      } else {
        showToast(`Welcoming you to ${suburbName}! Loaded spaces.`, "info");
      }
    } catch (err: any) {
      showToast("Found spaces in the neighborhood!", "info");
      setCenter([lat, lon]);
    } finally {
      setIsLoading(false);
    }
  };

  // Trigger search on selected autocomplete suggestion
  const handleSelectSuggestion = (item: any) => {
    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon);
    const title = item.display_name.split(",")[0];
    
    setSearchQuery("");
    setShowSuggestions(false);
    fetchParkingData(title, lat, lon);
  };

  // Handle Geolocation Request
  const handleGPSLocation = () => {
    if (!navigator.geolocation) {
      showToast("Your browser doesn't support sharing location", "error");
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`, {
            headers: {
              "User-Agent": "FreeParkingFinderApplet/1.0 (Jessedmaslen@gmail.com)"
            }
          });
          if (res.ok) {
            const data = await res.json();
            const suburbName = data.address.suburb || data.address.neighbourhood || data.address.suburb_borough || data.address.city || "Nearby Spaces";
            fetchParkingData(suburbName, latitude, longitude);
          } else {
            fetchParkingData("Nearby Spaces", latitude, longitude);
          }
        } catch (err) {
          fetchParkingData("My GPS Location", latitude, longitude);
        } finally {
          setIsLocating(false);
        }
      },
      (error) => {
        setIsLocating(false);
        showToast("Couldn't find your location. Try typing a street instead!", "error");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // Submit standard text input search
  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsLoading(true);
    setShowSuggestions(false);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(searchQuery)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          const bestMatch = data[0];
          const lat = parseFloat(bestMatch.lat);
          const lon = parseFloat(bestMatch.lon);
          const title = bestMatch.display_name.split(",")[0];
          fetchParkingData(title, lat, lon);
        } else {
          showToast(`No locations found matching "${searchQuery}"`, "error");
          setIsLoading(false);
        }
      }
    } catch (err) {
      showToast("Searching with coordinates instead...", "error");
      setIsLoading(false);
    }
  };

  // Submit a live user report status override
  const handleAddReport = (spotId: string) => {
    if (!newReportType) return;
    
    const newReport: ParkingReport = {
      type: newReportType,
      timestamp: Date.now(),
      note: newReportNote.trim() || undefined
    };

    const updatedReportsForSpot = [...(localReports[spotId] || []), newReport];
    const updatedAllReports = {
      ...localReports,
      [spotId]: updatedReportsForSpot
    };

    setLocalReports(updatedAllReports);
    localStorage.setItem("parking_reports", JSON.stringify(updatedAllReports));

    // Update coordinates in the current selectedSpot so active cards redraw instantly
    if (selectedSpot && selectedSpot.id === spotId) {
      setSelectedSpot({
        ...selectedSpot,
        userReports: updatedReportsForSpot
      });
    }

    // Reset report state
    setNewReportType(null);
    setNewReportNote("");
    setIsReporting(false);
    showToast("Thank you for sharing your report! Neighbors appreciate it! ☕️🌿", "success");
  };

  // Attempt to geocode address
  const handleFindCustomCoordinates = async () => {
    const addressToQuery = customForm.address.trim() || customForm.name.trim();
    if (!addressToQuery) {
      showToast("Please enter an address or spot location first!", "error");
      return;
    }

    setIsValidatingAddress(true);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(addressToQuery)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          const match = data[0];
          const lat = parseFloat(match.lat);
          const lon = parseFloat(match.lon);
          
          setCustomForm((prev) => ({
            ...prev,
            latitude: lat,
            longitude: lon,
            address: match.display_name.split(",").slice(0, 3).join(",") // cleaner string
          }));
          
          setCenter([lat, lon]);
          showToast("Address validated! Coordinate pin locked on map 🎯", "success");
        } else {
          const offsetLat = center[0] + (Math.random() - 0.5) * 0.002;
          const offsetLng = center[1] + (Math.random() - 0.5) * 0.002;
          
          setCustomForm((prev) => ({
            ...prev,
            latitude: offsetLat,
            longitude: offsetLng
          }));
          showToast("Location not found. Placed close to map center.", "info");
        }
      }
    } catch (err) {
      console.error("Custom spot locating error", err);
      const offsetLat = center[0] + (Math.random() - 0.5) * 0.002;
      const offsetLng = center[1] + (Math.random() - 0.5) * 0.002;
      setCustomForm((prev) => ({
        ...prev,
        latitude: offsetLat,
        longitude: offsetLng
      }));
    } finally {
      setIsValidatingAddress(false);
    }
  };

  // Submit custom spot/street data to backend
  const handleSubmitCustomSpot = async () => {
    if (!customForm.name.trim()) {
      showToast("Street name or Spot title is required!", "error");
      return;
    }
    if (!customForm.address.trim()) {
      showToast("Please provide an approximate address/intersection!", "error");
      return;
    }

    let lat = customForm.latitude;
    let lon = customForm.longitude;

    if (lat === null || lon === null) {
      const addressToQuery = customForm.address.trim() || customForm.name.trim();
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(addressToQuery)}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.length > 0) {
            lat = parseFloat(data[0].lat);
            lon = parseFloat(data[0].lon);
          }
        }
      } catch (err) {
        console.error("Implicit geocode failed", err);
      }

      if (lat === null || lon === null) {
        lat = center[0] + (Math.random() - 0.5) * 0.002;
        lon = center[1] + (Math.random() - 0.5) * 0.002;
      }
    }

    const payload = {
      name: customForm.name.trim(),
      type: customForm.type,
      latitude: lat,
      longitude: lon,
      address: customForm.address.trim(),
      costInfo: customForm.costInfo.trim() || "Free",
      timeLimit: customForm.timeLimit.trim() || "Unlimited",
      weekdaysRule: customForm.weekdaysRule.trim() || "Free & Unrestricted",
      weekendsRule: customForm.weekendsRule.trim() || "Free & Unrestricted",
      vacancyProbability: customForm.vacancyProbability,
      aiReasoning: customForm.aiReasoning.trim() || "Local crowdsourced spot reported with love by neighborhood driver.",
      suburb: suburbLabel
    };

    try {
      const res = await fetch("/api/parking/contribute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error("Server contribution error");

      const savedSpot: ParkingSpot = await res.json();

      setSpots((prev) => [savedSpot, ...prev]);
      setSelectedSpot(savedSpot);

      const existingContributed = localStorage.getItem("contributed_spots");
      const contributedArr = existingContributed ? JSON.parse(existingContributed) : [];
      localStorage.setItem("contributed_spots", JSON.stringify([savedSpot, ...contributedArr]));

      setCustomForm({
        name: "",
        address: "",
        type: "on-street",
        timeLimit: "",
        weekdaysRule: "",
        weekendsRule: "",
        costInfo: "",
        vacancyProbability: 70,
        aiReasoning: "",
        latitude: null,
        longitude: null,
      });
      setIsAddingCustomSpot(false);
      
      showToast(`Successfully registered ${payload.name}! Shared map updated. 🎉`, "success");
    } catch (err) {
      showToast("Could not submit parking spot data.", "error");
    }
  };

  // Map spots on display and merge with local community reports
  const displaySpots = spots.map((spot) => {
    const reportsForSpot = localReports[spot.id] || spot.userReports || [];
    
    // Auto-calculate probability based on reports
    let adjustedVacancy = spot.vacancyProbability;
    const latestReport = reportsForSpot.length > 0 ? reportsForSpot[reportsForSpot.length - 1] : null;

    if (latestReport) {
      if (latestReport.type === "occupied") {
        adjustedVacancy = 0;
      } else if (latestReport.type === "free") {
        adjustedVacancy = 100;
      }
    }

    return {
      ...spot,
      userReports: reportsForSpot,
      vacancyProbability: adjustedVacancy,
      isFavorite: favorites.some((f) => f.id === spot.id),
    };
  });

  // Filter spots on display
  const filteredSpots = displaySpots.filter((spot) => {
    // Filter tab selection
    if (filterType === "on-street" && spot.type !== "on-street") return false;
    if (filterType === "off-street" && spot.type !== "off-street") return false;
    
    // Filter vacancy threshold
    if (spot.vacancyProbability < minVacancy) return false;
    
    return true;
  });

  const activeSelectedProcessedSpot = selectedSpot 
    ? displaySpots.find((s) => s.id === selectedSpot.id) || selectedSpot 
    : null;

  // Render cozy vacancy indicator background colors
  const getVacancyColorClass = (prob: number) => {
    if (prob >= 70) return "bg-[#6B9080]/15 text-[#4E6C5F] border-[#6B9080]/30";
    if (prob >= 40) return "bg-[#F4F1DE] text-[#A57C43] border-[#F4F1DE]";
    return "bg-[#E76F51]/10 text-[#C8553D] border-[#E76F51]/20";
  };

  return (
    <div className="min-h-screen bg-[#FAF6F0] font-sans flex flex-col antialiased text-[#5F5D54]">
      {/* Warm and Toast Notification HUD */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`fixed top-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2.5 px-5 py-3.5 rounded-2xl shadow-xl text-xs font-semibold border backdrop-blur-md bg-[#FDFBF7] border-[#E6DCD2] text-[#5F5D54]`}
          >
            <div className="h-2 w-2 rounded-full bg-brand-clay animate-ping" />
            {notification.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Warm Cozy Header */}
      <header className="sticky top-0 bg-[#FDFBF7] border-b border-[#E6DCD2]/75 shadow-xs z-[1001] transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-18 flex items-center justify-between gap-4">
          
          {/* Logo & Slogan */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-terracotta rounded-xl shadow-sm flex items-center justify-center text-[#FDFBF7] font-bold text-lg hover:rotate-6 transition-transform">
              🌿
            </div>
            <div>
              <span className="font-display font-bold text-brand-terracotta text-xl tracking-tight flex items-center gap-2">
                SideStreet
              </span>
              <p className="text-[11px] text-brand-warmgray/70 -mt-0.5 font-medium">
                Simple, shared maps for local parking spots
              </p>
            </div>
          </div>

          {/* Preset Buttons quick dashboard */}
          <div className="hidden lg:flex items-center gap-1.5 bg-[#FAF6F0] p-1.5 rounded-2xl border border-[#E6DCD2]/60">
            <span className="text-[10px] uppercase font-bold text-brand-warmgray/50 px-2 tracking-wider font-display">Favorite Towns:</span>
            {PRESET_SUBURBS.map((p) => (
              <button
                key={p.name}
                onClick={() => fetchParkingData(p.name, p.lat, p.lng)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                  suburbLabel.toLowerCase().includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(suburbLabel.toLowerCase())
                    ? "bg-brand-terracotta text-[#FDFBF7] shadow-xs"
                    : "text-brand-warmgray/75 hover:text-brand-terracotta hover:bg-[#FDFBF7]/60"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Profile indicators / Star bookmarks */}
          <div className="flex items-center gap-3">
            <button
              id="toggle-favs-view"
              onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-2xl text-xs font-semibold tracking-tight transition-all border cursor-pointer ${
                showFavoritesOnly
                  ? "bg-[#F4F1DE] border-brand-terracotta text-brand-terracotta shadow-xs"
                  : "bg-[#FDFBF7] border-[#E6DCD2] text-brand-warmgray hover:bg-[#FAF6F0]"
              }`}
            >
              <Star className={`h-4 w-4 ${showFavoritesOnly ? "fill-brand-terracotta text-brand-terracotta" : "text-brand-warmgray"}`} />
              <span className="hidden md:inline">Bookmarks</span>
              {favorites.length > 0 && (
                <span className="h-5 min-w-5 rounded-full bg-brand-terracotta text-white text-[10px] font-bold px-1.5 flex items-center justify-center">
                  {favorites.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main layout container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 flex flex-col gap-6">
        
        {/* Cozy Search Banner */}
        <section className="bg-[#FDFBF7] rounded-3xl border border-[#E6DCD2] shadow-xs p-5 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
          
          {/* Form searching suburb */}
          <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md">
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-warmgray/60">
                <Search className="h-4.5 w-4.5" />
              </span>
              <input
                type="text"
                placeholder="Where are you heading today? (street, town, city...)"
                value={searchQuery}
                onFocus={() => setShowSuggestions(true)}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-10 py-3 bg-[#FAF6F0]/85 border border-[#E6DCD2] rounded-2xl text-sm placeholder-brand-warmgray/50 focus:outline-none focus:ring-4 focus:ring-brand-terracotta/10 focus:border-brand-terracotta font-sans transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-warmgray/40 hover:text-brand-warmgray"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Suburb autocomplete dropdown */}
            {showSuggestions && geocodingSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-2.5 bg-[#FDFBF7] border border-[#E6DCD2] rounded-2xl shadow-xl z-50 overflow-hidden py-1 max-h-60 overflow-y-auto">
                {geocodingSuggestions.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectSuggestion(item)}
                    className="w-full text-left px-4 py-3 hover:bg-[#FAF6F0] transition-colors text-xs flex items-start gap-2.5 border-b border-[#FAF6F0]/50 last:border-0"
                  >
                    <span className="text-brand-terracotta shrink-0 mt-0.5">
                      <MapPin className="h-4 w-4" />
                    </span>
                    <div>
                      <span className="font-bold text-brand-warmgray block">{item.display_name.split(",")[0]}</span>
                      <span className="text-brand-warmgray/50 text-[10px] leading-tight block truncate max-w-xs">{item.display_name}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </form>

          {/* Quick controls row */}
          <div className="flex flex-wrap items-center gap-3">
            
            {/* Find me location */}
            <button
              onClick={handleGPSLocation}
              disabled={isLocating}
              className="flex items-center gap-1.5 px-4.5 py-3 rounded-2xl border border-[#E6DCD2] bg-white text-brand-warmgray text-xs font-semibold hover:bg-[#FAF6F0] disabled:opacity-50 cursor-pointer shadow-2xs transition-colors"
            >
              <Compass className={`h-4 w-4 ${isLocating ? "animate-spin text-brand-terracotta" : "text-brand-warmgray/70"}`} />
              {isLocating ? "Seeking Location..." : "Nearby Places"}
            </button>

            {/* Separator */}
            <div className="h-8 w-px bg-[#E6DCD2]/70 hidden sm:block" />

            {/* Days Rules Switcher */}
            <div className="flex bg-[#FAF6F0] rounded-2xl p-1 border border-[#E6DCD2]/60">
              <button
                onClick={() => setDayType("weekday")}
                className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                  dayType === "weekday"
                    ? "bg-white shadow-xs text-brand-terracotta font-bold"
                    : "text-brand-warmgray/60 hover:text-brand-warmgray"
                }`}
              >
                Weekdays
              </button>
              <button
                onClick={() => setDayType("weekend")}
                className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                  dayType === "weekend"
                    ? "bg-white shadow-xs text-brand-clay font-bold"
                    : "text-brand-warmgray/60 hover:text-brand-warmgray"
                }`}
              >
                Weekends
              </button>
            </div>
          </div>
        </section>

        {/* Dashboard workspace layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          
          {/* LEFT Sidebar: Results and options */}
          <section className="lg:col-span-2 flex flex-col gap-4 max-h-[750px] lg:max-h-none overflow-y-auto lg:overflow-visible pr-0 lg:pr-1">
            
            {/* Soft Warm Dashboard Options */}
            <div className="bg-[#FDFBF7] rounded-3xl border border-[#E6DCD2] p-4.5 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-[#E6DCD2]/40 pb-2.5">
                <span className="text-xs font-bold text-brand-warmgray uppercase tracking-wider flex items-center gap-1.5 font-display">
                  <Filter className="h-3.5 w-3.5 text-brand-terracotta" />
                  Cozy Parking Filters
                </span>
                {minVacancy > 0 || filterType !== "all" ? (
                  <button
                    onClick={() => {
                      setMinVacancy(0);
                      setFilterType("all");
                    }}
                    className="text-[10px] text-brand-terracotta font-bold uppercase tracking-wider hover:opacity-80"
                  >
                    Clear Filters
                  </button>
                ) : null}
              </div>

              {/* Slider for Min Vacancy Probability */}
              <div>
                <div className="flex justify-between text-xs mb-1.5 font-medium text-brand-warmgray">
                  <span>Minimum Vacancy Preference</span>
                  <span className="font-bold text-brand-terracotta font-sans">{minVacancy}% Vacant</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="80"
                  step="10"
                  value={minVacancy}
                  onChange={(e) => setMinVacancy(parseInt(e.target.value))}
                  className="w-full accent-brand-terracotta h-1.5 bg-[#FAF6F0] rounded-lg appearance-none cursor-pointer"
                />
              </div>

              {/* Categorization tabs */}
              <div className="grid grid-cols-3 gap-1 bg-[#FAF6F0] p-1 rounded-xl border border-[#E6DCD2]/60">
                {(["all", "on-street", "off-street"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setFilterType(t)}
                    className={`py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                      filterType === t
                        ? "bg-white text-brand-terracotta border border-[#E6DCD2]/50 shadow-xs font-black"
                        : "text-brand-warmgray/60 hover:text-brand-warmgray"
                    }`}
                  >
                    {t === "all" ? "All Spaces" : t === "on-street" ? "Street-Side" : "Parking Lots"}
                  </button>
                ))}
              </div>
            </div>

            {/* List Header */}
            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[#F4F1DE]/60 border border-[#E6DCD2] text-brand-warmgray/95">
              <div className="flex items-center gap-2">
                <h2 className="font-display font-bold text-brand-warmgray text-xs uppercase tracking-wider">
                  {showFavoritesOnly ? "Starred Places" : `Spaces in ${suburbLabel}`}
                </h2>
                <span className="bg-brand-terracotta text-white text-[10px] px-2.5 py-0.5 font-bold rounded-full leading-none">
                  {showFavoritesOnly ? favorites.length : filteredSpots.length} found
                </span>
              </div>

              {!showFavoritesOnly && (
                <div className="flex items-center gap-1.5 text-[9px] text-brand-warmgray/60 uppercase font-bold font-mono">
                  <span className={`px-2 py-0.5 rounded-full border border-[#E6DCD2] bg-white text-xs`}>
                    {searchSource === "ai" ? "Gemini Sourced" : "Community Map"}
                  </span>
                </div>
              )}
            </div>

            {/* Spot Cards List Container */}
            <div className="flex flex-col gap-3 min-h-[300px]">
              {/* Crowdsourcing add-spot banner button */}
              {!isLoading && !showFavoritesOnly && (
                !isAddingCustomSpot ? (
                  <button
                    id="btn-trigger-add-spot"
                    onClick={() => setIsAddingCustomSpot(true)}
                    className="p-4 rounded-2xl border-2 border-dashed border-[#E6DCD2] hover:border-brand-terracotta bg-white/50 hover:bg-white text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-1.5"
                  >
                    <span className="text-xs font-bold text-brand-terracotta flex items-center gap-1.5">
                      ➕ Don't see a free street? Add it here
                    </span>
                    <span className="text-[11px] text-brand-warmgray/50 font-semibold select-none leading-none">
                      Register a new free parking space on the map
                    </span>
                  </button>
                ) : (
                  <motion.div
                    id="form-add-spot"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white border-2 border-brand-terracotta rounded-2xl p-4.5 shadow-sm space-y-3.5 relative text-left"
                  >
                    <button
                      onClick={() => setIsAddingCustomSpot(false)}
                      className="absolute right-3.5 top-3.5 text-brand-warmgray/40 hover:text-brand-warmgray/80"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <h3 className="text-xs font-bold font-display uppercase tracking-wider text-brand-terracotta flex items-center gap-1.5">
                      ✨ Add Free Parking Area
                    </h3>
                    
                    {/* Form fields */}
                    <div className="space-y-2.5 text-xs">
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-brand-warmgray/50 mb-1">Street name or Spot title *</label>
                        <input
                          type="text"
                          placeholder="e.g. Barkly Street Free Visual Area"
                          value={customForm.name}
                          onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })}
                          className="w-full bg-[#FAF6F0] border border-[#E6DCD2] rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-terracotta/20 focus:border-brand-terracotta placeholder-neutral-400"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold text-brand-warmgray/50 mb-1">Interactive Address Locator *</label>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            placeholder="Search or enter exact address..."
                            value={customForm.address}
                            onChange={(e) => setCustomForm({ ...customForm, address: e.target.value })}
                            className="flex-1 bg-[#FAF6F0] border border-[#E6DCD2] rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-terracotta/20 focus:border-brand-terracotta placeholder-neutral-400"
                          />
                          <button
                            type="button"
                            onClick={handleFindCustomCoordinates}
                            disabled={isValidatingAddress}
                            className="px-3 bg-brand-terracotta hover:bg-brand-clay text-[#FAF6F0] font-bold rounded-xl text-[11px] transition-colors shadow-2xs cursor-pointer"
                          >
                            {isValidatingAddress ? "Seeking..." : "Pin"}
                          </button>
                        </div>
                        <p className="text-[9px] text-[#A57C43] font-medium mt-1 leading-normal">
                          Pin locks coordinates automatically so other users can navigate.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] uppercase font-bold text-brand-warmgray/50 mb-1">Space Style</label>
                          <select
                            value={customForm.type}
                            onChange={(e) => setCustomForm({ ...customForm, type: e.target.value as any })}
                            className="w-full bg-[#FAF6F0] border border-[#E6DCD2] rounded-xl px-3 py-2 focus:outline-none"
                          >
                            <option value="on-street">Street Side</option>
                            <option value="off-street">Parking Lot</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-bold text-brand-warmgray/50 mb-1">Time Limits</label>
                          <input
                            type="text"
                            placeholder="e.g. 2P, Unlimited"
                            value={customForm.timeLimit}
                            onChange={(e) => setCustomForm({ ...customForm, timeLimit: e.target.value })}
                            className="w-full bg-[#FAF6F0] border border-[#E6DCD2] rounded-xl px-3 py-2 text-xs focus:outline-none placeholder-neutral-400"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] uppercase font-bold text-brand-warmgray/50 mb-1">Mon-Fri Rules</label>
                          <input
                            type="text"
                            placeholder="e.g. Free 2P 8am-6pm"
                            value={customForm.weekdaysRule}
                            onChange={(e) => setCustomForm({ ...customForm, weekdaysRule: e.target.value })}
                            className="w-full bg-[#FAF6F0] border border-[#E6DCD2] rounded-xl px-3 py-2 text-xs focus:outline-none placeholder-neutral-400"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-bold text-brand-warmgray/50 mb-1">Weekend Rules</label>
                          <input
                            type="text"
                            placeholder="e.g. Completely Free"
                            value={customForm.weekendsRule}
                            onChange={(e) => setCustomForm({ ...customForm, weekendsRule: e.target.value })}
                            className="w-full bg-[#FAF6F0] border border-[#E6DCD2] rounded-xl px-3 py-2 text-xs focus:outline-none placeholder-neutral-400"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] uppercase font-bold text-brand-warmgray/50 mb-1">Rate / Cost info</label>
                          <input
                            type="text"
                            placeholder="e.g. 100% Free, Free 1st hour"
                            value={customForm.costInfo}
                            onChange={(e) => setCustomForm({ ...customForm, costInfo: e.target.value })}
                            className="w-full bg-[#FAF6F0] border border-[#E6DCD2] rounded-xl px-3 py-2 text-xs focus:outline-none placeholder-neutral-400"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-bold text-brand-warmgray/50 mb-1">Vacancy Chance (0-100%)</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={customForm.vacancyProbability}
                            onChange={(e) => setCustomForm({ ...customForm, vacancyProbability: parseInt(e.target.value) || 50 })}
                            className="w-full bg-[#FAF6F0] border border-[#E6DCD2] rounded-xl px-3 py-2 text-xs focus:outline-none"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold text-brand-warmgray/50 mb-1">Driver Advice & Tips</label>
                        <textarea
                          rows={2}
                          placeholder="e.g. Back alleys are clean, inspectors frequent at 2:00pm"
                          value={customForm.aiReasoning}
                          onChange={(e) => setCustomForm({ ...customForm, aiReasoning: e.target.value })}
                          className="w-full bg-[#FAF6F0] border border-[#E6DCD2] rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand-terracotta placeholder-neutral-400"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleSubmitCustomSpot}
                      className="w-full py-2.5 bg-brand-terracotta hover:bg-brand-clay text-white font-bold rounded-2xl text-xs transition-colors shadow-md shadow-brand-terracotta/10 flex items-center justify-center gap-1 cursor-pointer"
                    >
                      🚀 Publish Free Spot to Public Map
                    </button>
                  </motion.div>
                )
              )}
              {isLoading ? (
                <div className="bg-[#FDFBF7] rounded-3xl border border-[#E6DCD2] p-8 flex flex-col items-center justify-center text-center">
                  <div className="relative mb-3.5">
                    <RefreshCw className="h-8 w-8 text-brand-terracotta animate-spin" />
                    <Sparkles className="absolute -top-1 -right-1.5 h-4.5 w-4.5 text-brand-clay animate-bounce" />
                  </div>
                  <h3 className="font-display font-semibold text-brand-warmgray text-sm">Searching the area...</h3>
                  <p className="text-xs text-brand-warmgray/60 max-w-xs mt-1 leading-normal">
                    AI is reviewing local maps, signboards, and neighborhood bounds to discover free parking spaces.
                  </p>
                </div>
              ) : (showFavoritesOnly ? favorites : filteredSpots).length === 0 ? (
                <div className="bg-[#FDFBF7] rounded-3xl border border-[#E6DCD2] p-8 flex flex-col items-center justify-center text-center">
                  <div className="h-10 w-10 rounded-full bg-[#FAF6F0] flex items-center justify-center mb-3">
                    <X className="h-5 w-5 text-brand-warmgray/50" />
                  </div>
                  <h3 className="font-display font-semibold text-brand-warmgray text-sm">
                    {showFavoritesOnly ? "No bookmarks saved yet" : "No spaces match your filters"}
                  </h3>
                  <p className="text-xs text-brand-warmgray/50 max-w-xs mt-1.5 leading-normal">
                    {showFavoritesOnly 
                      ? "Star your favorite parking spots to keep them saved here!"
                      : "Try loosening your filters or resetting the vacancy threshold."}
                  </p>
                </div>
              ) : (
                (showFavoritesOnly ? favorites : filteredSpots).map((spot, index) => {
                  const isSelected = selectedSpot ? selectedSpot.id === spot.id : false;
                  const activeRule = dayType === "weekday" ? spot.weekdaysRule : spot.weekendsRule;
                  const distanceApprox = `${Math.round(200 + (100 - spot.proximityScore) * 8)}m`;
                  
                  // Check latest report for card indicators
                  const latestReport = spot.userReports && spot.userReports.length > 0 
                    ? spot.userReports[spot.userReports.length - 1] 
                    : null;

                  return (
                    <motion.div
                      key={spot.id}
                      onClick={() => {
                        setSelectedSpot(spot);
                        // Reset nested active reporter form states on click selection change
                        setNewReportType(null);
                        setNewReportNote("");
                        setIsReporting(false);
                      }}
                      layoutId={`spot-card-${spot.id}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`group hover:border-brand-terracotta cursor-pointer bg-[#FDFBF7] rounded-2xl border p-4 shadow-2xs transition-all relative ${
                        isSelected 
                          ? "ring-2 ring-brand-terracotta border-transparent bg-white shadow-xs" 
                          : "border-[#E6DCD2] hover:bg-[#FDFBF7]/40"
                      }`}
                    >
                      <div className="flex justify-between items-start mb-1 gap-2">
                        <h3 className="text-sm font-bold text-brand-warmgray group-hover:text-brand-terracotta font-display transition-colors">
                          {spot.name}
                        </h3>
                        <span className="text-[10px] font-bold text-[#6B9080] bg-[#6B9080]/10 px-2 py-0.5 rounded-lg shrink-0 uppercase">
                          FREE
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-[11px] text-brand-warmgray/60">{distanceApprox} away</span>
                        <span className="text-brand-warmgray/30 text-xs">•</span>
                        <span className="text-[11px] text-brand-warmgray/60 font-semibold">{spot.type === "on-street" ? "Quiet Street" : "Local Lot"}</span>
                        <span className="text-brand-warmgray/30 text-xs">•</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(spot);
                          }}
                          className="text-brand-warmgray/30 hover:text-brand-terracotta transition-colors cursor-pointer inline-flex items-center"
                        >
                          <Star className={`h-4 w-4 ${spot.isFavorite ? "fill-brand-terracotta text-brand-terracotta" : "text-brand-warmgray/40"}`} />
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-4 mt-2 bg-[#FAF6F0]/60 p-2.5 rounded-xl border border-[#E6DCD2]/40">
                        <div className="flex flex-col">
                          <span className="text-[9px] uppercase text-brand-warmgray/50 font-bold">Estimated Vacancy</span>
                          <span className="text-xs font-bold text-brand-terracotta flex items-center gap-1">
                            {spot.vacancyProbability}% {spot.vacancyProbability > 70 ? "High Chance" : spot.vacancyProbability > 30 ? "Fair Chance" : "Likely Occupied"}
                          </span>
                        </div>
                        <div className="w-20 h-2 bg-[#FAF6F0] rounded-full overflow-hidden shrink-0 border border-[#E6DCD2]/20">
                          <div 
                            className={`h-full transition-all duration-500 ${
                              spot.vacancyProbability > 70 
                                ? "bg-[#6B9080]" 
                                : spot.vacancyProbability > 30 
                                ? "bg-brand-clay" 
                                : "bg-red-400"
                            }`}
                            style={{ width: `${spot.vacancyProbability}%` }}
                          />
                        </div>
                      </div>

                      {/* Recent User reporter status text banner */}
                      {latestReport && (
                        <div className="mt-2.5 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border bg-[#FDFBF7] text-[10px] leading-tight font-medium border-orange-100/70">
                          <span>{latestReport.type === "occupied" ? "🔴 Reported Full" : latestReport.type === "free" ? "🟢 Reported Empty" : "⚠️ Meter broken / Issues"}</span>
                          <span className="text-brand-warmgray/40">•</span>
                          <span className="text-brand-warmgray/60 italic truncate">
                            {latestReport.note ? `"${latestReport.note}"` : "Just shared"}
                          </span>
                        </div>
                      )}

                      {/* Display quick limits */}
                      <p className="text-[11.5px] text-brand-warmgray/60 mt-2.5 pt-2 border-t border-[#E6DCD2]/30 truncate">
                        💡 {activeRule}
                      </p>

                      {/* Expanded spot controls and comment block */}
                      {isSelected && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          className="mt-4.5 border-t border-dashed border-[#E6DCD2] pt-3.5 space-y-3.5"
                          onClick={(e) => e.stopPropagation()} // Prevent deselection
                        >
                          {spot.aiReasoning && (
                            <div className="text-[11px] text-brand-warmgray/70 leading-relaxed bg-[#F4F1DE]/30 p-2.5 rounded-xl border border-[#F4F1DE]">
                              <span className="font-bold text-brand-warmgray flex items-center gap-1 mb-1 font-display uppercase tracking-wide text-[9px] text-brand-terracotta">
                                <Sparkles className="h-3.5 w-3.5 text-brand-clay" />
                                Neighborhood Tips
                              </span>
                              {spot.aiReasoning}
                            </div>
                          )}

                          {/* Community feedback and report flow widget */}
                          <div className="bg-[#FAF6F0] p-3 rounded-2xl border border-[#E6DCD2]/60 shadow-2xs">
                            <h4 className="text-xs font-bold text-brand-warmgray mb-2 flex items-center gap-1.5 font-display">
                              <MessageSquare className="h-3.5 w-3.5 text-brand-terracotta" />
                              Spot status reported by other drivers
                            </h4>

                            {!isReporting ? (
                              <div className="flex flex-col gap-2">
                                <p className="text-[10px] text-brand-warmgray/60 leading-normal">
                                  See a parked car, empty bay, or broken meter? Let your neighbors know!
                                </p>
                                <button
                                  type="button"
                                  onClick={() => setIsReporting(true)}
                                  className="w-full py-1.5 bg-white hover:bg-[#FDFBF7] text-brand-terracotta border border-[#E6DCD2] text-[11px] font-bold rounded-xl transition-all shadow-2xs"
                                >
                                  ✍️ Update This Spot's Availability
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-3 antialiased">
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] font-bold uppercase text-brand-warmgray/40">Select Live Status:</span>
                                  <button 
                                    className="text-[9px] text-brand-warmgray underline"
                                    onClick={() => {
                                      setIsReporting(false);
                                      setNewReportType(null);
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                                <div className="grid grid-cols-3 gap-1.5">
                                  {(["free", "occupied", "broken"] as const).map((type) => (
                                    <button
                                      key={type}
                                      type="button"
                                      onClick={() => setNewReportType(type)}
                                      className={`py-1.5 text-[10px] font-bold rounded-xl border text-center transition-all ${
                                        newReportType === type
                                          ? type === "free"
                                            ? "bg-[#6B9080] text-white border-transparent"
                                            : type === "occupied"
                                            ? "bg-brand-clay text-white border-transparent"
                                            : "bg-[#F4F1DE] text-brand-terracotta border-brand-terracotta"
                                          : "bg-white border-[#E6DCD2] text-brand-warmgray hover:bg-[#FAF6F0]"
                                      }`}
                                    >
                                      {type === "free" ? "🟢 Empty" : type === "occupied" ? "🔴 Parked" : "⚠️ Broken"}
                                    </button>
                                  ))}
                                </div>

                                <input
                                  type="text"
                                  placeholder="Leave optional note (e.g. 'Just left!', 'Taped meter')"
                                  value={newReportNote}
                                  onChange={(e) => setNewReportNote(e.target.value)}
                                  className="w-full text-[11px] bg-white border border-[#E6DCD2] rounded-xl px-2.5 py-1.5 text-brand-warmgray focus:outline-none focus:ring-2 focus:ring-brand-terracotta/20 focus:border-brand-terracotta"
                                />

                                <button
                                  type="button"
                                  disabled={!newReportType}
                                  onClick={() => handleAddReport(spot.id)}
                                  className="w-full py-1.5 bg-brand-terracotta text-white font-bold rounded-xl text-xs hover:bg-brand-clay disabled:opacity-50 shadow-md shadow-brand-terracotta/10 transition-colors"
                                >
                                  Submit Updates to Map & List
                                </button>
                              </div>
                            )}

                            {/* Historic reports logged list */}
                            {spot.userReports && spot.userReports.length > 0 && (
                              <div className="mt-3.5 pt-3 border-t border-[#E6DCD2]/40">
                                <p className="text-[9px] uppercase tracking-wider text-brand-warmgray/40 font-bold mb-1.5">Reports History:</p>
                                <div className="space-y-1.5 max-h-24 overflow-y-auto">
                                  {spot.userReports.slice().reverse().map((rep, rIdx) => {
                                    const minutesAgo = Math.round((Date.now() - rep.timestamp) / 60000);
                                    let timeString = minutesAgo < 1 ? "Just now" : minutesAgo === 1 ? "1 min ago" : `${minutesAgo} mins ago`;
                                    if (minutesAgo > 60) {
                                      timeString = "Earlier today";
                                    }
                                    return (
                                      <div key={rIdx} className="text-[10px] bg-white py-1.5 px-2 rounded-lg border border-[#E6DCD2]/30 flex justify-between gap-2">
                                        <span className="font-semibold text-brand-warmgray">
                                          {rep.type === "free" ? "🟢 Spot Empty" : rep.type === "occupied" ? "🔴 Full" : "⚠️ Issue"}: <span className="font-normal text-brand-warmgray/75"> {rep.note || "status updated"}</span>
                                        </span>
                                        <span className="text-[9px] text-[#A57C43] font-mono shrink-0">{timeString}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </motion.div>
                  );
                })
              )}
            </div>
          </section>

          {/* RIGHT Sidebar: Live Map container with overlay details */}
          <section className="lg:col-span-3 flex flex-col gap-4 h-full">
            <div className="bg-[#FDFBF7] rounded-3xl border border-[#E6DCD2] p-4 shadow-xs h-full flex flex-col min-h-[500px] relative">
              
              {/* Map Title pane status */}
              <div className="flex items-center justify-between gap-2.5 mb-3.5 border-b border-[#E6DCD2]/40 pb-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#6B9080] animate-pulse" />
                  <h3 className="font-display font-semibold text-xs text-brand-warmgray leading-none">
                    Local Town Parking Map Grid
                  </h3>
                </div>

                {selectedSpot ? (
                  <button
                    onClick={() => setSelectedSpot(null)}
                    className="text-[10px] font-bold text-brand-terracotta hover:opacity-85 flex items-center gap-1 cursor-pointer bg-[#FAF6F0] border border-[#E6DCD2]/50 px-2 py-1 rounded-xl"
                  >
                    Clear Focus
                    <X className="h-3 w-3" />
                  </button>
                ) : (
                  <span className="text-[10px] text-brand-warmgray/50">
                    Showing {filteredSpots.length} neighborhood spots
                  </span>
                )}
              </div>

              {/* Map Component wrapper */}
              <div className="flex-1 w-full min-h-[450px] relative">
                <ParkingMap
                  spots={filteredSpots}
                  center={center}
                  selectedSpot={activeSelectedProcessedSpot}
                  onSelectSpot={setSelectedSpot}
                  dayType={dayType}
                />

                {/* Floating details overlay card on active map selection */}
                <AnimatePresence>
                  {activeSelectedProcessedSpot && (
                    <motion.div
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 15 }}
                      className="absolute bottom-6 right-6 left-6 sm:left-auto w-auto sm:w-80 bg-[#FDFBF7] rounded-2xl shadow-2xl border border-[#E6DCD2] p-5 z-[1000]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex justify-between items-start mb-2.5 gap-2">
                        <div>
                          <h2 className="text-sm font-bold text-brand-warmgray font-display mt-0.5 leading-tight">{activeSelectedProcessedSpot.name}</h2>
                          <p className="text-[11px] text-[#A57C43] truncate max-w-[190px]">{activeSelectedProcessedSpot.address}</p>
                        </div>
                        <div className="flex items-center gap-1 text-right shrink-0">
                          <button 
                            onClick={() => toggleFavorite(activeSelectedProcessedSpot)}
                            className="p-1.5 hover:bg-[#FAF6F0] rounded-xl text-slate-400 hover:text-amber-500"
                          >
                            <Star className={`w-4 h-4 ${favorites.some((f) => f.id === activeSelectedProcessedSpot.id) ? "fill-brand-terracotta text-brand-terracotta" : "text-brand-warmgray/40"}`} />
                          </button>
                        </div>
                      </div>

                      {/* Display recent reported badge overlay */}
                      {activeSelectedProcessedSpot.userReports && activeSelectedProcessedSpot.userReports.length > 0 && (
                        <div className="mb-2.5 bg-orange-50/50 p-2 rounded-xl text-[10px] border border-orange-100 italic font-medium leading-relaxed">
                          ⚡️ Report: <strong>{activeSelectedProcessedSpot.userReports[activeSelectedProcessedSpot.userReports.length - 1].type.toUpperCase()}</strong> - "{activeSelectedProcessedSpot.userReports[activeSelectedProcessedSpot.userReports.length - 1].note || 'Recent updates shared'}"
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2.5 mb-3">
                        <div className="p-2.5 bg-[#FAF6F0] rounded-xl border border-[#E6DCD2]/30">
                          <span className="block text-[8px] text-brand-warmgray/40 uppercase font-black mb-0.5">Rates info</span>
                          <span className="text-xs font-bold text-[#6B9080] tracking-tight">{activeSelectedProcessedSpot.costInfo || "No charge"}</span>
                        </div>
                        <div className="p-2.5 bg-[#FAF6F0] rounded-xl border border-[#E6DCD2]/30">
                          <span className="block text-[8px] text-brand-warmgray/40 uppercase font-black mb-0.5">Hours Limits</span>
                          <span className="text-xs font-bold text-brand-terracotta tracking-tight truncate">{activeSelectedProcessedSpot.timeLimit || "No limit"}</span>
                        </div>
                      </div>

                      <div className="space-y-1 bg-[#F4F1DE]/20 p-2.5 rounded-xl border border-[#E6DCD2]/40 mb-3.5 select-none text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-brand-warmgray/50">Mon-Fri limits</span>
                          <span className="text-brand-warmgray font-semibold text-right truncate max-w-[130px]" title={activeSelectedProcessedSpot.weekdaysRule}>{activeSelectedProcessedSpot.weekdaysRule}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-brand-warmgray/50">Weekend limits</span>
                          <span className="text-brand-warmgray font-semibold text-right truncate max-w-[130px]" title={activeSelectedProcessedSpot.weekendsRule}>{activeSelectedProcessedSpot.weekendsRule}</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        {/* Report availability status directly from map card popup */}
                        {!isReporting ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setIsReporting(true);
                              }}
                              className="flex-1 py-2 bg-[#F4F1DE]/60 hover:bg-[#F4F1DE] border border-brand-cream text-brand-terracotta text-[11px] font-bold rounded-xl transition-all"
                            >
                              ✍️ Report Status Update
                            </button>
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${activeSelectedProcessedSpot.latitude},${activeSelectedProcessedSpot.longitude}`}
                              target="_blank"
                              rel="noreferrer"
                              className="py-2.5 px-3 bg-brand-terracotta hover:bg-brand-clay text-white font-bold rounded-xl text-center text-xs transition-colors shadow-md shadow-brand-terracotta/10 inline-flex items-center justify-center"
                              title="Open Navigation"
                            >
                              <Navigation className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        ) : (
                          <div className="bg-[#FAF6F0] p-2.5 rounded-xl border border-[#E6DCD2]/50 text-[11px] space-y-2">
                            <div className="flex justify-between items-center text-[9px] text-[#A57C43] font-bold">
                              <span>REPORT FEEDBACK</span>
                              <button onClick={() => setIsReporting(false)} className="underline text-brand-warmgray">Cancel</button>
                            </div>
                            <div className="grid grid-cols-3 gap-1">
                              {(["free", "occupied", "broken"] as const).map((ty) => (
                                <button
                                  key={ty}
                                  onClick={() => setNewReportType(ty)}
                                  className={`py-1 text-[9px] font-bold rounded-lg border text-center transition-colors ${
                                    newReportType === ty
                                      ? ty === "free"
                                        ? "bg-[#6B9080] text-white border-transparent"
                                        : ty === "occupied"
                                        ? "bg-brand-clay text-white border-transparent"
                                        : "bg-[#F4F1DE] text-brand-terracotta border-brand-terracotta"
                                      : "bg-white border-[#E6DCD2] text-brand-warmgray hover:bg-[#FAF6F0]"
                                  }`}
                                >
                                  {ty === "free" ? "🟢 Empty" : ty === "occupied" ? "🔴 Parked" : "⚠️ Broken"}
                                </button>
                              ))}
                            </div>
                            <input
                              type="text"
                              placeholder="Add short comment..."
                              value={newReportNote}
                              onChange={(e) => setNewReportNote(e.target.value)}
                              className="w-full text-[10px] bg-white border border-[#E6DCD2] rounded-lg px-2 py-1 text-brand-warmgray focus:outline-none focus:ring-1 focus:ring-brand-terracotta"
                            />
                            <button
                              disabled={!newReportType}
                              onClick={() => handleAddReport(activeSelectedProcessedSpot.id)}
                              className="w-full py-1 bg-brand-terracotta hover:bg-brand-clay text-white font-bold rounded-lg text-[10px] transition-colors"
                            >
                              Publish to Neighbors
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Bottom Quick-Start advice banner */}
              <div className="mt-4 bg-[#FDFBF7] border border-[#E6DCD2] rounded-3xl p-4 flex items-start gap-3.5">
                <div className="h-9 w-9 shrink-0 rounded-2xl bg-[#6B9080]/15 flex items-center justify-center text-[#6B9080]">
                  🌱
                </div>
                <div className="text-xs text-brand-warmgray/90">
                  <h4 className="font-bold text-brand-warmgray leading-none">Shared Neighborhood Map</h4>
                  <p className="text-brand-warmgray/70 leading-normal mt-1 text-[11px]">
                    This guide lets you mark, search, and update free street slots safely. Use the live reporting buttons to tell people if you just parked or left, so we can save gas and find free spots together!
                  </p>
                </div>
              </div>
            </div>
          </section>

        </div>
      </main>

      {/* Comforting Cozy Footer */}
      <footer className="mt-14 py-8 bg-[#FAF6F0] border-t border-[#E6DCD2]/70 text-center text-xs text-brand-warmgray/50 select-none">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="font-medium text-[11px]">
            🐾 Created with love for friendly, cozy neighborhoods. Keep sharing parking updates! ☕️🍂
          </p>
          <div className="flex items-center gap-3 font-mono text-[10px] text-brand-warmgray/40">
            <span>&copy; {new Date().getFullYear()} SideStreet Community</span>
            <span>•</span>
            <span>Local Drivers reporting live</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
