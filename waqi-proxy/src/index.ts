export interface Env {
  WAQI_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    try {
      const url = new URL(request.url);
      
      // Make sure we correctly format the target WAQI API URL
      // If client requests /feed/here/, we forward to https://api.waqi.info/feed/here/
      const targetUrl = new URL(`https://api.waqi.info${url.pathname}${url.search}`);
      
      // Securely append the token from our secret environment variable
      targetUrl.searchParams.set("token", env.WAQI_TOKEN);

      const res = await fetch(targetUrl.toString());
      const data = await res.text();

      return new Response(data, {
        status: res.status,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message || "Proxy error" }), {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
      });
    }
  },
};
