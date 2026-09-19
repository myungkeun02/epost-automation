import { chromium } from "playwright-core";
import { PageFlow } from "./page-flow.js";
import { EpostError, safeError } from "../errors.js";
import {
  validateCredentials,
  validateReservationNumber,
} from "../validation.js";

const ENTRY =
  "https://parcel.epost.go.kr/general.RetrieveGeneralNewGubunLogin.parcel#";
const RESERVATIONS =
  "https://parcel.epost.go.kr/general.RetrieveResrevationNew.parcel?cmd=reservation&onLoadState=init";

// Missing/empty counters must never be interpreted as a canceled reservation.
export function parseRemaining(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
  const count = Number(value.trim());
  return Number.isSafeInteger(count) ? count : null;
}

export function parseConfirmation(url) {
  try {
    const parsed = new URL(url);
    if (
      parsed.origin !== "https://parcel.epost.go.kr" ||
      parsed.pathname !== "/general.RetrieveResrevationNew.parcel" ||
      parsed.searchParams.get("result") !== "S"
    )
      return null;
    return validateReservationNumber(parsed.searchParams.get("res_ser"));
  } catch {
    return null;
  }
}

export class KoreaPostWeb {
  #credentials;
  #username;
  #options;
  #flow = new PageFlow();
  constructor({
    credentials,
    username,
    headless = true,
    executablePath,
    timeoutMs = 60_000,
    operationTimeoutMs = 300_000,
  } = {}) {
    if (typeof credentials === "function") {
      if (typeof username !== "string" || !username.trim())
        throw new EpostError("VALIDATION", { field: "username" });
      this.#username = username.trim();
      this.#credentials = credentials;
    } else {
      const login = validateCredentials(credentials);
      this.#username = login.username;
      const snapshot = {
        ...credentials,
        card: credentials.card ? { ...credentials.card } : undefined,
      };
      this.#credentials = () => snapshot;
    }
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1000 ||
      timeoutMs > 300_000 ||
      !Number.isSafeInteger(operationTimeoutMs) ||
      operationTimeoutMs < timeoutMs ||
      operationTimeoutMs > 900_000 ||
      typeof headless !== "boolean"
    )
      throw new EpostError("VALIDATION", { field: "browserOptions" });
    this.#options = { headless, executablePath, timeoutMs, operationTimeoutMs };
  }
  get accountId() {
    return this.#username;
  }
  async #session(payment, action, phone) {
    let browser,
      context,
      deadline,
      expired = false;
    try {
      const credentials = validateCredentials(
        await this.#credentials(),
        payment,
      );
      if (credentials.username.toLowerCase() !== this.#username.toLowerCase())
        throw new EpostError("VALIDATION", { field: "credentials.username" });
      const { timeoutMs, operationTimeoutMs, ...launchOptions } = this.#options;
      browser = await chromium.launch({
        ...launchOptions,
        timeout: timeoutMs,
        chromiumSandbox: true,
      });
      // Closing the browser interrupts page.evaluate(fetch) too. A naked
      // Promise.race would leave a submission running after reporting failure.
      deadline = setTimeout(() => {
        expired = true;
        void browser.close().catch(() => {});
      }, operationTimeoutMs);
      deadline.unref();
      context = await browser.newContext({
        locale: "ko-KR",
        timezoneId: "Asia/Seoul",
        viewport: { width: 1440, height: 1200 },
        acceptDownloads: false,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      page.setDefaultNavigationTimeout(timeoutMs);
      // Persist neither storageState nor trace/network bodies. Dialog messages
      // may include names or payment data and are never returned to callers.
      page.on("dialog", async (dialog) => {
        try {
          const message = dialog.message();
          if (this.#flow.dismissInstallationDialog(message))
            return await dialog.dismiss();
          if (dialog.type() === "prompt") {
            if (phone && this.#flow.requiresPhoneVerification(message))
              return await dialog.accept(phone.slice(-8, -4));
            return await dialog.dismiss();
          }
          await dialog.accept();
        } catch {
          /* The page may have closed at the operation deadline. */
        }
      });
      const legacyCredentials = {
        loginId: credentials.username,
        loginPassword: credentials.password,
        cardNumber: credentials.card?.number,
        cardExpMmYy: credentials.card?.expiry,
        cardPasswordPrefix: credentials.card?.passwordPrefix,
        cardBirthOrBusinessNumber: credentials.card?.identity,
      };
      await page.goto(ENTRY, { waitUntil: "domcontentloaded" });
      try {
        await this.#flow.login(
          page,
          { entryUrl: ENTRY },
          legacyCredentials,
          timeoutMs,
        );
      } catch {
        throw new EpostError("AUTHENTICATION");
      }
      const result = await action(page, legacyCredentials, timeoutMs);
      if (expired) throw new EpostError("PROVIDER_FAILURE");
      return result;
    } catch (error) {
      throw safeError(error);
    } finally {
      if (deadline) clearTimeout(deadline);
      await context?.close().catch(() => {});
      await browser?.close().catch(() => {});
    }
  }
  async reserve(request, { beforeSubmit }) {
    return this.#session(true, async (page, credentials, timeoutMs) => {
      await page.goto(ENTRY, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#genAmtForm");
      await this.#flow.waitForForm(page, timeoutMs);
      const draftCount = await page.evaluate(() => {
        const provider = globalThis.dataProvider;
        return typeof provider?.getRowCount === "function"
          ? provider.getRowCount()
          : null;
      });
      if (draftCount !== 0) throw new EpostError("EXISTING_DRAFT");
      const form = {
        pickupRequestedDate: request.pickupDate,
        pickup: {
          requestedDate: request.pickupDate,
          requestedDateIso: request.pickupDate,
          wishReceiptTime: "",
          wishReceiptTimeInterval: request.pickup.timeInterval,
          from: {
            ...request.sender,
            phoneField: /^01[016789]/.test(request.sender.phone)
              ? "MOBILE"
              : "PHONE",
          },
        },
        receiver: {
          ...request.recipient,
          phoneField: /^01[016789]/.test(request.recipient.phone)
            ? "MOBILE"
            : "PHONE",
        },
        parcel: {
          itemName: request.parcel.description,
          quantity: 1,
          weightCode: request.parcel.weightCode,
          sizeCode: request.parcel.sizeCode,
          contentCode: request.parcel.contentCode,
        },
        payment: {
          methodNew: "3",
          pickupKeep: request.pickup.locationCode,
          pickupKeepName: request.pickup.locationDescription,
        },
        requestMemo: request.memo,
      };
      await this.#flow.fillReservation(page, form, credentials);
      await this.#flow.verifyFields(page, form);
      // A missing option must fail before any draft/card/reservation mutation.
      const codesMatch = await page.evaluate(
        ({ parcel, pickup }) => {
          const value = (id) =>
            (
              globalThis.document.getElementById(id) ??
              globalThis.document.querySelector(`[name="${id}"]`)
            )?.value;
          return (
            value("limit_wg") === parcel.weightCode &&
            value("limit_vol") === parcel.sizeCode &&
            value("productCodeCombo") === parcel.contentCode &&
            value("pickupKeep") === pickup.locationCode
          );
        },
        { parcel: request.parcel, pickup: request.pickup },
      );
      if (!codesMatch)
        throw new EpostError("VALIDATION", { field: "parcelOrPickupCodes" });
      const selected = await this.#flow.selectSchedule(page, form, timeoutMs);
      if (selected.pickupRequestedDate !== request.pickupDate)
        throw new EpostError("PROVIDER_FAILURE");
      // This barrier precedes even draft writes/card authorization, intentionally
      // conservative: any failure after it requires operator reconciliation.
      await beforeSubmit();
      await this.#flow.addRecipient(page, form, [], timeoutMs);
      await this.#flow.certifyCard(page, [], timeoutMs);
      let finalPosts = 0;
      // Block duplicate final POSTs triggered by a site handler too, not only
      // duplicates at the application entry point.
      await page.route(
        "**/general.InsertNewGeneralReserve.parcel*",
        async (route) => {
          if (route.request().method() === "POST" && ++finalPosts > 1)
            await route.abort();
          else await route.fallback();
        },
      );
      await this.#flow.submitReservation(page, form, [], timeoutMs);
      const reservationNumber = parseConfirmation(page.url());
      if (!reservationNumber || finalPosts !== 1)
        throw new EpostError("PROVIDER_FAILURE");
      const result = await this.#readReservation(
        page,
        reservationNumber,
        timeoutMs,
      );
      if (result.status !== "reserved")
        throw new EpostError("PROVIDER_FAILURE");
      return result;
    });
  }
  async #readReservation(page, number, timeoutMs, select = false) {
    await this.#flow.loadReservations(page, RESERVATIONS, number, timeoutMs);
    const row = await page.evaluate(
      ({ number, select }) => {
        const doc = globalThis.document;
        const hidden = Array.from(
          doc.querySelectorAll('input[name="visitRecevResSer"]'),
        ).find((element) => element.value === number);
        const row = hidden?.closest("tr");
        if (!row) return null;
        if (select) {
          const radio = row.querySelector('input[name="rdreserv"]');
          if (!radio) return null;
          for (const other of doc.querySelectorAll('input[name="rdreserv"]'))
            other.checked = false;
          radio.checked = true;
          radio.click();
        }
        const tracking = Array.from(row.querySelectorAll("input")).find(
          (input) => /rgist|track|invoice/i.test(input.name),
        )?.value;
        return {
          remaining:
            row.querySelector('input[name="cur_box_amt"]')?.value ?? null,
          trackingNumber:
            typeof tracking === "string" && /^\d{13}$/.test(tracking)
              ? tracking
              : null,
        };
      },
      { number, select },
    );
    if (!row) throw new EpostError("NOT_FOUND");
    const remaining = parseRemaining(row.remaining);
    return {
      reservationNumber: number,
      trackingNumber: row.trackingNumber,
      status:
        remaining === null
          ? "unknown"
          : remaining === 0
            ? "canceled"
            : "reserved",
    };
  }
  async lookup(number) {
    return this.#session(false, (page, _credentials, timeout) =>
      this.#readReservation(page, number, timeout),
    );
  }
  async options() {
    return this.#session(false, async (page, _credentials, timeout) => {
      await page.goto(ENTRY, { waitUntil: "domcontentloaded" });
      await this.#flow.waitForForm(page, timeout);
      return page.evaluate(() => {
        const read = (name) =>
          Array.from(
            (
              globalThis.document.getElementById(name) ??
              globalThis.document.querySelector(`[name="${name}"]`)
            )?.options ?? [],
          )
            .filter((option) => /^\d{2,3}$/.test(option.value))
            .map((option) => ({
              code: option.value,
              label: option.textContent.trim(),
            }));
        return {
          weights: read("limit_wg"),
          sizes: read("limit_vol"),
          contents: read("productCodeCombo"),
          pickupLocations: read("pickupKeep"),
        };
      });
    });
  }
  async cancel(request, { beforeSubmit }) {
    return this.#session(
      false,
      async (page, _credentials, timeout) => {
        const current = await this.#readReservation(
          page,
          request.reservationNumber,
          timeout,
          true,
        );
        if (current.status === "canceled") return current;
        if (current.status !== "reserved")
          throw new EpostError("NOT_CANCELABLE");
        await this.#flow.waitForDetail(
          page,
          request.reservationNumber,
          timeout,
        );
        const detail = await this.#flow.inspectDetail(page);
        // Partial cancellation is a separate operation; never silently cancel
        // only the available subset of a request to cancel the whole reservation.
        if (
          !detail.totalCount ||
          detail.cancelableCount !== detail.totalCount ||
          detail.disabledCount ||
          detail.siteDisabledCount
        )
          throw new EpostError("NOT_CANCELABLE");
        await beforeSubmit();
        await Promise.all([
          page
            .waitForNavigation({ waitUntil: "domcontentloaded", timeout })
            .catch(() => {}),
          this.#flow.submitCancellation(page, "all"),
        ]);
        const verified = await this.#readReservation(
          page,
          request.reservationNumber,
          timeout,
        );
        if (verified.status !== "canceled")
          throw new EpostError("PROVIDER_FAILURE");
        return verified;
      },
      request.recipientPhone,
    );
  }
}
