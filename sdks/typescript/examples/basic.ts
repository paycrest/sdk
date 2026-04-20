import { createPaycrestClient } from "../src/index.js";

async function main() {
  const apiKey = process.env.PAYCREST_API_KEY || "YOUR_API_KEY";
  const client = createPaycrestClient({ apiKey });
  const sender = client.sender();

  const stats = await sender.getStats();
  console.log(stats);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
