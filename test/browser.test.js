import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { KoreaPostWeb } from "../src/index.js";
import { validateReservation } from "../src/validation.js";
import { parseRemaining, parseConfirmation } from "../src/browser/provider.js";
import {
  formHTML,
  listHTML,
  loginHTML,
  reservationNumber,
  list,
} from "./fixtures/site.js";

test("empty, malformed and negative parcel counters never mean canceled", () => {
  for (const value of [
    null,
    undefined,
    "",
    " ",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    "9007199254740992",
  ])
    assert.equal(parseRemaining(value), null);
  assert.equal(parseRemaining("0"), 0);
  assert.equal(parseRemaining("2"), 2);
});
test("reservation identifiers in arbitrary HTML or URLs cannot imply success", () => {
  assert.equal(
    parseConfirmation(`${list}?result=S&res_ser=${reservationNumber}`),
    reservationNumber,
  );
  for (const value of [
    `${list}?result=F&res_ser=${reservationNumber}`,
    `${list}?res_ser=${reservationNumber}`,
    `https://evil.example/?result=S&res_ser=${reservationNumber}`,
    `${list}/other?result=S&res_ser=${reservationNumber}`,
  ])
    assert.equal(parseConfirmation(value), null);
});

// Opt in to real Chromium fixture tests. All browser network requests are routed
// to synthetic HTML/XML or blocked; these tests never call Korea Post.
const browserTest = process.env.EPOST_TEST_BROWSER === "1" ? test : test.skip;
const credentials = {
  username: "synthetic-test",
  password: "synthetic-password",
  card: {
    number: "0000000000000000",
    expiry: "1299",
    passwordPrefix: "00",
    identity: "000000",
  },
};
const request = validateReservation(
  JSON.parse(
    readFileSync(new URL("../examples/reservation.json", import.meta.url)),
  ),
);
const originalLaunch = chromium.launch.bind(chromium);
async function fixture(t, options = {}) {
  const state = { posts: 0, cancelPosts: 0, remaining: "1", ...options };
  const browser = await originalLaunch({
    executablePath: process.env.EPOST_TEST_BROWSER_PATH || undefined,
    headless: true,
  });
  t.after(() => browser.close());
  const createContext = async () => {
    state.contexts = (state.contexts ?? 0) + 1;
    const context = await browser.newContext();
    await context.setOffline(true);
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const fulfill = (body, contentType = "text/html") =>
        route.fulfill({ status: 200, contentType, body });
      if (url.pathname.includes("cafzc008k01")) return fulfill(loginHTML());
      if (url.pathname.includes("RetrieveGeneralNewGubunLogin"))
        return fulfill(formHTML(state));
      if (url.pathname.includes("RetrieveEasypayCert"))
        return fulfill("<root><resultcd>0000</resultcd></root>", "text/xml");
      if (url.pathname.includes("InsertNewGeneralReserve")) {
        state.posts++;
        if (state.disconnect) return route.abort("connectionreset");
        return fulfill(
          `<script>location.replace(${JSON.stringify(`${list}?result=S&res_ser=${reservationNumber}`)})</script>`,
        );
      }
      if (url.pathname.includes("RetrieveResrevationNew"))
        return fulfill(listHTML(state));
      if (url.pathname.includes("RemoveResAmt")) {
        state.cancelPosts++;
        if (!state.cancelFailure) state.remaining = "0";
        return fulfill("ok");
      }
      return route.abort();
    });
    return context;
  };
  // Give the real provider a routed isolated context; every page method and
  // extracted browser callback still runs in Chromium.
  t.mock.method(chromium, "launch", async (options) => {
    state.launches = (state.launches ?? 0) + 1;
    state.handleSIGINT = options.handleSIGINT;
    return { newContext: createContext, close: () => browser.close() };
  });
  const provider = new KoreaPostWeb({
    credentials,
    timeoutMs: 1000,
    operationTimeoutMs: 15_000,
  });
  return { provider, state };
}
browserTest(
  "browser: batch reuses one browser with isolated per-item contexts and graceful signals",
  async (t) => {
    const { provider, state } = await fixture(t);
    await provider.withBrowser(async () => {
      assert.equal(
        (await provider.lookup(reservationNumber)).status,
        "reserved",
      );
      assert.equal(
        (await provider.lookup(reservationNumber)).status,
        "reserved",
      );
    });
    assert.equal(state.launches, 1);
    assert.equal(state.contexts, 2);
    assert.equal(state.handleSIGINT, false);
  },
);
browserTest(
  "browser: registration executes the real DOM flow once and confirms the row",
  async (t) => {
    const { provider, state } = await fixture(t);
    let barriers = 0;
    const result = await provider.reserve(request, {
      beforeSubmit: async () => {
        barriers++;
        assert.equal(state.posts, 0);
      },
    });
    assert.equal(result.reservationNumber, reservationNumber);
    assert.equal(result.status, "reserved");
    assert.equal(state.posts, 1);
    assert.equal(barriers, 1);
  },
);
browserTest(
  "browser: existing draft is preserved and submission is never reached",
  async (t) => {
    const { provider, state } = await fixture(t, { draftCount: 1 });
    let barriers = 0;
    await assert.rejects(
      provider.reserve(request, {
        beforeSubmit: async () => {
          barriers++;
        },
      }),
      { code: "EXISTING_DRAFT" },
    );
    assert.equal(state.posts, 0);
    assert.equal(barriers, 0);
  },
);
browserTest(
  "browser: an unavailable requested date is never replaced with another",
  async (t) => {
    const { provider, state } = await fixture(t, { date: "2099-01-03" });
    let barriers = 0;
    await assert.rejects(
      provider.reserve(request, {
        beforeSubmit: async () => {
          barriers++;
        },
      }),
      { code: "PROVIDER_FAILURE" },
    );
    assert.equal(state.posts, 0);
    assert.equal(barriers, 0);
  },
);
browserTest(
  "browser: unavailable explicit time interval fails before submission",
  async (t) => {
    const { provider, state } = await fixture(t);
    let barriers = 0;
    await assert.rejects(
      provider.reserve(
        { ...request, pickup: { ...request.pickup, timeInterval: "17001800" } },
        {
          beforeSubmit: async () => {
            barriers++;
          },
        },
      ),
      { code: "PROVIDER_FAILURE" },
    );
    assert.equal(state.posts, 0);
    assert.equal(barriers, 0);
  },
);
browserTest(
  "browser: landline phone fields are preserved correctly",
  async (t) => {
    const { provider, state } = await fixture(t);
    const landline = {
      ...request,
      sender: { ...request.sender, phone: "020000000" },
      recipient: { ...request.recipient, phone: "050700000000" },
    };
    const result = await provider.reserve(landline, {
      beforeSubmit: async () => {},
    });
    assert.equal(result.status, "reserved");
    assert.equal(state.posts, 1);
  },
);
browserTest(
  "browser: cancellation verifies zero remaining parcels after submission",
  async (t) => {
    const { provider, state } = await fixture(t);
    let barriers = 0;
    const result = await provider.cancel(
      { reservationNumber, recipientPhone: "01000000000" },
      {
        beforeSubmit: async () => {
          barriers++;
        },
      },
    );
    assert.equal(result.status, "canceled");
    assert.equal(state.cancelPosts, 1);
    assert.equal(barriers, 1);
  },
);
browserTest(
  "browser: partial cancellation is rejected before changing anything",
  async (t) => {
    const { provider, state } = await fixture(t, { cancelable: false });
    let barriers = 0;
    await assert.rejects(
      provider.cancel(
        { reservationNumber, recipientPhone: "01000000000" },
        {
          beforeSubmit: async () => {
            barriers++;
          },
        },
      ),
      { code: "NOT_CANCELABLE" },
    );
    assert.equal(state.cancelPosts, 0);
    assert.equal(barriers, 0);
  },
);
browserTest(
  "browser: already canceled returns success without calling cancel",
  async (t) => {
    const { provider, state } = await fixture(t, { remaining: "0" });
    assert.equal(
      (
        await provider.cancel(
          { reservationNumber, recipientPhone: "01000000000" },
          { beforeSubmit: async () => assert.fail("must not submit") },
        )
      ).status,
      "canceled",
    );
    assert.equal(state.cancelPosts, 0);
  },
);
browserTest(
  "browser: empty count is unknown and cannot be canceled",
  async (t) => {
    const { provider, state } = await fixture(t, { remaining: "" });
    await assert.rejects(
      provider.cancel(
        { reservationNumber, recipientPhone: "01000000000" },
        { beforeSubmit: async () => assert.fail("must not submit") },
      ),
      { code: "NOT_CANCELABLE" },
    );
    assert.equal(state.cancelPosts, 0);
  },
);
browserTest(
  "browser: response loss causes one submission, no automatic retry",
  async (t) => {
    const { provider, state } = await fixture(t, { disconnect: true });
    await assert.rejects(
      provider.reserve(request, { beforeSubmit: async () => {} }),
      { code: "PROVIDER_FAILURE" },
    );
    assert.equal(state.posts, 1);
  },
);
browserTest("browser: duplicate site POST attempts are blocked", async (t) => {
  const { provider, state } = await fixture(t, { duplicate: true });
  await assert.rejects(
    provider.reserve(request, { beforeSubmit: async () => {} }),
    { code: "PROVIDER_FAILURE" },
  );
  assert.equal(state.posts, 1);
});
