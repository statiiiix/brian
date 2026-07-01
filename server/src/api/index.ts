import { loadServerEnv } from "../env.js";
loadServerEnv();

const { buildApp } = await import("./app.js");

const port = Number(process.env.PORT ?? 3001);
buildApp()
  .listen({ port, host: "0.0.0.0" })
  .then((addr) => console.log(`API listening on ${addr}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
