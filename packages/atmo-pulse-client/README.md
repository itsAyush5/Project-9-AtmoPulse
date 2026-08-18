# @atmo-pulse/client

TypeScript client for AtmoPulse air-quality services.

## Installation

```bash
npm install @atmo-pulse/client
```

## Usage

```ts
import { AtmoPulse } from "@atmo-pulse/client";

const atmo = new AtmoPulse({
  baseUrl: "https://your-api.example.com/air-quality"
});

const result = await atmo.getAirQuality("Delhi");
console.log(result.aqi);
```

## Configuration

- `baseUrl` — your AtmoPulse API endpoint.
- `apiKey` — optional bearer token.

## Status

This package is the initial SDK foundation for AtmoPulse and is versioned independently from the web application.
