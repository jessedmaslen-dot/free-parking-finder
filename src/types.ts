export interface ParkingReport {
  type: 'free' | 'occupied' | 'broken';
  timestamp: number;
  note?: string;
}

export interface ParkingSpot {
  id: string;
  name: string;
  type: 'off-street' | 'on-street';
  latitude: number;
  longitude: number;
  address: string;
  costInfo: string;
  timeLimit: string;
  weekdaysRule: string;
  weekendsRule: string;
  vacancyProbability: number; // 0 to 100%
  proximityScore: number;     // 0 to 100% (or rank index)
  aiReasoning: string;
  isFavorite?: boolean;
  userReports?: ParkingReport[];
}

export interface SuburbLocation {
  name: string;
  latitude: number;
  longitude: number;
  boundingBox?: [number, number, number, number]; // [minLat, maxLat, minLng, maxLng]
}

export interface ParkingSearchResponse {
  suburb: string;
  location: SuburbLocation;
  spots: ParkingSpot[];
  searchSource: 'ai' | 'simulation';
  error?: string;
}
