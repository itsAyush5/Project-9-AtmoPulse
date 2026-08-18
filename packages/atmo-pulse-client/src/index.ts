export interface AtmoPulseConfig {
  baseUrl: string;
  apiKey?: string;
}

export interface AirQualityResult {
  aqi: number;
  [key: string]: unknown;
}

export class AtmoPulse {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(config: AtmoPulseConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }

  async getAirQuality(city: string): Promise<AirQualityResult> {
    const url = new URL(this.baseUrl);
    url.searchParams.set("city", city);

    const response = await fetch(url, {
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
    });

    if (!response.ok) {
      throw new Error(`AtmoPulse API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<AirQualityResult>;
  }
}
