import { useEffect, useRef } from "react";
import L from "leaflet";
import { ParkingSpot } from "../types";

interface ParkingMapProps {
  spots: ParkingSpot[];
  center: [number, number];
  selectedSpot: ParkingSpot | null;
  onSelectSpot: (spot: ParkingSpot) => void;
  dayType: "weekday" | "weekend";
}

export default function ParkingMap({
  spots,
  center,
  selectedSpot,
  onSelectSpot,
  dayType,
}: ParkingMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ [key: string]: L.Marker }>({});
  const markersGroupRef = useRef<L.FeatureGroup | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!containerRef.current) return;

    // Create the map instance
    const map = L.map(containerRef.current, {
      zoomControl: false, // Custom placement later or keep standard
    }).setView(center, 15);

    // Add high-resolution, eye-safe beautiful map tiles (CartoDB Positron for clean visual balance)
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 20,
      }
    ).addTo(map);

    // Add standard zoom controls to the top right to keep it clean
    L.control.zoom({ position: "topright" }).addTo(map);

    mapRef.current = map;
    markersGroupRef.current = L.featureGroup().addTo(map);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Sync Map Viewport when query center changes
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setView(center, 15, { animate: true, duration: 1 });
    }
  }, [center]);

  // Sync Markers when spots list or selectedSpot changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !markersGroupRef.current) return;

    // Clear existing markers
    markersGroupRef.current.clearLayers();
    markersRef.current = {};

    spots.forEach((spot) => {
      const isSelected = selectedSpot ? selectedSpot.id === spot.id : false;
      const isOffStreet = spot.type === "off-street";

      // Color scheme matching our cozy theme: Terracotta for street, Sage for off-street, Warm Clay for active selection
      let markerColor = "#D96B43"; // Terracotta
      let secondaryColor = "#B24C28"; 
      if (isOffStreet) {
        markerColor = "#6B9080"; // Sage Green
        secondaryColor = "#4E6C5F";
      }
      if (isSelected) {
        markerColor = "#E76F51"; // Active selection clay
        secondaryColor = "#C8553D";
      }

      // Check if spot has recent user reporting feedback
      const latestReport = spot.userReports && spot.userReports.length > 0 
        ? spot.userReports[spot.userReports.length - 1] 
        : null;

      let reportBadgeHtml = "";
      if (latestReport) {
        if (latestReport.type === "occupied") {
          reportBadgeHtml = `<span style="background-color: #FEE2E2; color: #DC2626; padding: 1px 4px; border-radius: 4px; font-weight: bold; border: 1px solid #FECACA; font-size: 8px; font-family: sans-serif; text-transform: uppercase;">Occupied</span>`;
        } else if (latestReport.type === "free") {
          reportBadgeHtml = `<span style="background-color: #ECFDF5; color: #059669; padding: 1px 4px; border-radius: 4px; font-weight: bold; border: 1px solid #A7F3D0; font-size: 8px; font-family: sans-serif; text-transform: uppercase;">Free</span>`;
        } else if (latestReport.type === "broken") {
          reportBadgeHtml = `<span style="background-color: #FEF3C7; color: #D97706; padding: 1px 4px; border-radius: 4px; font-weight: bold; border: 1px solid #FDE68A; font-size: 8px; font-family: sans-serif; text-transform: uppercase;">Out of Order</span>`;
        }
      }

      // Generate custom SVGs inline to avoid broken assets when bundling
      const customIconHtml = `
        <div class="relative flex items-center justify-center transition-transform duration-300 ${isSelected ? "scale-125 z-[999]" : "hover:scale-110 z-[500]"}">
          <svg class="w-9 h-9 drop-shadow-md" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C8.13 2 5 5.13 5 9C5 14.25 12 22 12 22C12 22 19 14.25 19 9C19 5.13 15.87 2 12 2Z" fill="${markerColor}" stroke="#FFFFFF" stroke-opacity="0.9" stroke-width="1.8"/>
            <path d="M12 12C13.6569 12 15 10.6569 15 9C15 7.34315 13.6569 6 12 6C10.3431 6 9 7.34315 9 9C9 10.6569 10.3431 12 12 12Z" fill="${isSelected ? "#FFFFFF" : secondaryColor}"/>
          </svg>
          <div class="absolute -top-1 right-[-4px] flex h-5 w-5 items-center justify-center rounded-full bg-[#E76F51] border border-white text-[9px] font-bold text-white px-1">
            P
          </div>
          ${latestReport ? `<div class="absolute -bottom-2 bg-white px-1 py-0.5 rounded shadow border border-slate-100 text-[8px] font-black scale-90 whitespace-nowrap">${latestReport.type === 'occupied' ? '🔴' : latestReport.type === 'free' ? '🟢' : '⚠️'}</div>` : ''}
          ${
            isSelected
              ? `<span class="absolute inline-flex h-12 w-12 animate-ping rounded-full bg-orange-400 opacity-20 -z-10"></span>`
              : ""
          }
        </div>
      `;

      const customIcon = L.divIcon({
        html: customIconHtml,
        className: "custom-leaflet-pin",
        iconSize: [36, 42],
        iconAnchor: [18, 42],
        popupAnchor: [0, -42],
      });

      const marker = L.marker([spot.latitude, spot.longitude], {
        icon: customIcon,
      });

      // Bind elegant popup with full details
      const ruleToDisplay = dayType === "weekday" ? spot.weekdaysRule : spot.weekendsRule;
      const hoursToDisplay = spot.timeLimit || "No Limit";

      // Calculate state for popup values based on live overrides
      let adjustedVacancy = spot.vacancyProbability;
      if (latestReport) {
        if (latestReport.type === "occupied") adjustedVacancy = 0;
        if (latestReport.type === "free") adjustedVacancy = 100;
      }

      const popupHtml = `
        <div class="p-3 max-w-[240px] font-sans" style="background-color: #FDFBF7;">
          <div class="flex items-center gap-1.5 mb-1.5 justify-between">
            <span class="inline-block px-2 py-0.5 rounded text-[10px] uppercase font-bold text-white tracking-wider ${
              isOffStreet ? "bg-[#6B9080]" : "bg-[#D96B43]"
            }">
              ${spot.type}
            </span>
            ${latestReport ? reportBadgeHtml : `<span class="text-[11px] font-mono text-gray-400">P Score: ${spot.proximityScore}</span>`}
          </div>
          <h4 class="font-bold text-gray-900 text-sm leading-tight mb-1" style="font-family: Fredoka, sans-serif;">${spot.name}</h4>
          <p class="text-xs text-gray-500 mb-2 truncate">${spot.address}</p>
          <div class="border-t border-gray-100 pt-2 grid grid-cols-2 gap-1 text-[11px] font-medium leading-normal mb-2">
            <div>
              <span class="text-gray-400 block font-normal uppercase text-[9px] tracking-tight">Time Cap</span>
              <span class="text-[#D96B43] font-bold">${hoursToDisplay}</span>
            </div>
            <div>
              <span class="text-gray-400 block font-normal uppercase text-[9px] tracking-tight">Vacancy</span>
              <span class="font-bold ${
                adjustedVacancy > 60
                  ? "text-emerald-700"
                  : adjustedVacancy > 30
                  ? "text-amber-600"
                  : "text-rose-600"
              }">${adjustedVacancy}%</span>
            </div>
          </div>
          ${latestReport && latestReport.note ? `<p class="text-[10px] bg-amber-50 text-amber-900 p-1 rounded border border-amber-200/50 mb-2 italic">📌 "${latestReport.note}"</p>` : ''}
          <p class="text-[11px] text-gray-500 bg-orange-50/40 p-1.5 rounded border border-orange-100/50 mt-1 leading-relaxed">
            <strong>Active Rules:</strong> ${ruleToDisplay}
          </p>
          <div class="text-[10px] text-[#D96B43] font-semibold italic mt-1 leading-tight">
            🐾 ${spot.costInfo}
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml, {
        closeButton: false,
        className: "custom-leaflet-popup",
      });

      // Handle marker events
      marker.on("click", () => {
        onSelectSpot(spot);
      });

      if (markersGroupRef.current) {
        markersGroupRef.current.addLayer(marker);
      }
      markersRef.current[spot.id] = marker;
    });

    // Fit boundary circles elegantly if there are spots
    if (spots.length > 0 && map && !selectedSpot) {
      const bounds = spots.map((s) => [s.latitude, s.longitude] as [number, number]);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }, [spots, selectedSpot, dayType]);

  // Open popup dynamically when selectedSpot triggers external selection
  useEffect(() => {
    if (selectedSpot && markersRef.current[selectedSpot.id]) {
      const marker = markersRef.current[selectedSpot.id];
      marker.openPopup();
      if (mapRef.current) {
        mapRef.current.setView([selectedSpot.latitude, selectedSpot.longitude], 16, {
          animate: true,
          duration: 0.8,
        });
      }
    }
  }, [selectedSpot]);

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden border border-[#E6DCD2] shadow-sm">
      {/* Cozy branding elements in the map margins conforming to layout precision */}
      <div className="absolute bottom-3 left-3 bg-[#FDFBF7]/95 text-brand-terracotta text-[10px] px-3 py-1.5 rounded-xl shadow-md z-[1000] flex items-center gap-2 border border-[#E6DCD2] backdrop-blur-xs font-semibold">
        <span className="flex h-2 w-2 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-clay opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-clay"></span>
        </span>
        Live neighborhood reports active
      </div>

      <div
        ref={containerRef}
        id="parking-map-canvas"
        className="w-full h-full"
        style={{ minHeight: "450px" }}
      />
    </div>
  );
}
