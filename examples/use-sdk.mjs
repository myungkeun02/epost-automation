import { readFile } from "node:fs/promises";
import {
  EpostClient,
  KoreaPostWeb,
  validateReservation,
} from "../src/index.js";

const input = JSON.parse(
  await readFile(new URL("./reservation.json", import.meta.url), "utf8"),
);
validateReservation(input);
console.log("입력 형식 확인 완료. 실제 접수 예제는 README를 참고하세요.");

// Integrate these objects in your own application. Do not use the synthetic
// example contacts for a live reservation. This example does not submit.
export function createClient() {
  return new EpostClient({
    journalPath: ".epost/operations.sqlite",
    provider: new KoreaPostWeb({
      credentials: {
        username: process.env.EPOST_USERNAME,
        password: process.env.EPOST_PASSWORD,
        card: {
          number: process.env.EPOST_CARD_NUMBER,
          expiry: process.env.EPOST_CARD_EXPIRY,
          passwordPrefix: process.env.EPOST_CARD_PASSWORD_PREFIX,
          identity: process.env.EPOST_CARD_IDENTITY,
        },
      },
    }),
  });
}
