// Internal Korea Post page integration. Not part of the public API.
export class PageFlow {
  async login(page, request, credentials, timeoutMs) {
    const loginUrl =
      "https://www.epost.go.kr/usr/login/cafzc008k01.jsp?login=parcel18";
    await page.goto(loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await this.submitLogin(page, credentials, timeoutMs);
    await page.goto(request.entryUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    const loggedIn = await page
      .locator("#genAmtForm")
      .count()
      .catch(() => 0);
    if (loggedIn <= 0) {
      const finalUrl = this.stripUrlQuery(page.url());
      const title = await page.title().catch(() => "");
      throw new Error(
        `우체국 로그인 후 방문접수 예약 폼을 찾지 못했습니다. finalUrl=${finalUrl}, title=${title}`,
      );
    }
  }
  async fillReservation(page, request, credentials) {
    await page.evaluate(
      ({ request, credentials }) => {
        const win = globalThis;
        const doc = win.document;
        const EventCtor = win.Event;
        const digits = (value) => String(value ?? "").replace(/[^0-9]/g, "");
        const splitPhone = (value) => {
          const raw = digits(value);
          if (raw.startsWith("02"))
            return ["02", raw.slice(2, -4), raw.slice(-4)];
          if (raw.startsWith("050"))
            return [raw.slice(0, 4), raw.slice(4, -4), raw.slice(-4)];
          return [raw.slice(0, 3), raw.slice(3, -4), raw.slice(-4)];
        };
        const setValue = (nameOrId, value) => {
          const el =
            doc.querySelector(`[name="${nameOrId}"]`) ||
            doc.getElementById(nameOrId);
          if (!el || value == null) return;
          el.value = String(value);
          el.dispatchEvent(new EventCtor("input", { bubbles: true }));
          el.dispatchEvent(new EventCtor("change", { bubbles: true }));
        };
        const setRadio = (name, value) => {
          const input = doc.querySelector(
            `input[type="radio"][name="${name}"][value="${value}"]`,
          );
          if (!input) return;
          input.checked = true;
          input.dispatchEvent(new EventCtor("change", { bubbles: true }));
        };
        const setChecked = (nameOrId, checked) => {
          const input =
            doc.querySelector(`[name="${nameOrId}"]`) ||
            doc.getElementById(nameOrId);
          if (!input) return;
          input.checked = checked;
          input.dispatchEvent(new EventCtor("change", { bubbles: true }));
        };
        const pickup = request.pickup.from;
        const receiver = request.receiver;
        const pickupPhone = splitPhone(pickup.phone);
        const receiverPhone = splitPhone(receiver.phone);
        const pickupPhoneField =
          pickup.phoneField ||
          (/^01[016789]/.test(digits(pickup.phone)) ? "MOBILE" : "PHONE");
        const receiverPhoneField =
          receiver.phoneField ||
          (/^01[016789]/.test(digits(receiver.phone)) ? "MOBILE" : "PHONE");
        const setPhone = (field, parts, mobileFields, phoneFields) => {
          mobileFields.forEach((name, index) =>
            setValue(name, field === "MOBILE" ? parts[index] : ""),
          );
          phoneFields.forEach((name, index) =>
            setValue(name, field === "PHONE" ? parts[index] : ""),
          );
        };
        const cardNumber = digits(credentials.cardNumber).padEnd(16, " ");
        const cardPassword = digits(credentials.cardPasswordPrefix);
        const requestedDate = request.pickup.requestedDate;
        const requestedDateIso = request.pickup.requestedDateIso;
        const weightCode = request.parcel.weightCode || "02";
        const sizeCode = request.parcel.sizeCode || "02";
        const productCode = request.parcel.contentCode || "023";
        const itemName = request.parcel.itemName || "물품";
        const pickupKeep = request.payment.pickupKeep || "01";
        setChecked("parcelUseGuideInfoChkBox", true);
        setValue("curCnt", "0");
        setValue("custName", pickup.name);
        setValue("labname", pickup.name);
        setValue("newPostNum", pickup.zipCode);
        setValue("postAddr", pickup.address);
        setValue("detailAddr", pickup.detailAddress);
        setPhone(
          pickupPhoneField,
          pickupPhone,
          ["cell1", "cell2", "cell3"],
          ["phone1", "phone2", "phone3"],
        );
        setValue(
          "labmobile_num",
          pickupPhoneField === "MOBILE" ? pickupPhone[1] : "",
        );
        setValue("email", request.email || "");
        setValue("labemail", request.email || "");
        setRadio("charge", "001");
        setValue("feeChargeYN", "001");
        const setReceiptDeliveryDisabled = () => {
          const offSelectors = [
            "#mreceipt_n",
            "#mobilReceipt_n",
            'input[type="radio"][name="mreceipt"][value="N"]',
            'input[type="radio"][name="mobilReceipt"][value="N"]',
            'input[type="radio"][name="sendMailYn"][value="N"]',
          ];
          const onSelectors = [
            "#mreceipt_y",
            "#mobilReceipt_y",
            'input[type="radio"][name="mreceipt"][value="Y"]',
            'input[type="radio"][name="mobilReceipt"][value="Y"]',
            'input[type="radio"][name="sendMailYn"][value="Y"]',
          ];
          for (const selector of onSelectors) {
            for (const input of Array.from(doc.querySelectorAll(selector))) {
              input.checked = false;
              input.dispatchEvent(new EventCtor("change", { bubbles: true }));
            }
          }
          for (const selector of offSelectors) {
            for (const input of Array.from(doc.querySelectorAll(selector))) {
              input.checked = true;
              input.dispatchEvent(new EventCtor("change", { bubbles: true }));
            }
          }
          for (const name of ["mreceipt", "mobilReceipt", "sendMailYn"]) {
            for (const input of Array.from(
              doc.querySelectorAll(`[name="${name}"]`),
            )) {
              if (input.type === "radio" || input.type === "checkbox") continue;
              input.value = "N";
              input.dispatchEvent(new EventCtor("input", { bubbles: true }));
              input.dispatchEvent(new EventCtor("change", { bubbles: true }));
            }
          }
        };
        setReceiptDeliveryDisabled();
        setRadio("method", request.payment.methodNew || "3");
        setValue("wishReceiptTime", requestedDate);
        setValue("wishReceiptDate", requestedDate);
        setValue("hopeRceptDe", requestedDate);
        setValue("hopeReceiptDate", requestedDate);
        setValue("wishReceiptTimeText", requestedDateIso);
        setValue("pickupKeep", pickupKeep);
        setValue("pickupKeepNm", request.payment.pickupKeepName || "");
        setValue("receiverName", receiver.name);
        setValue("newRePostNum", receiver.zipCode);
        setValue("rePostAddr", receiver.address);
        setValue("reDetailAddr", receiver.detailAddress);
        setPhone(
          receiverPhoneField,
          receiverPhone,
          ["reCell1", "reCell2", "reCell3"],
          ["rePhone1", "rePhone2", "rePhone3"],
        );
        setValue("sendCustName", pickup.name);
        setValue("newSendPostNum", pickup.zipCode);
        setValue("sendPostAddr", pickup.address);
        setValue("sendDetailAddr", pickup.detailAddress);
        setPhone(
          pickupPhoneField,
          pickupPhone,
          ["sendCell1", "sendCell2", "sendCell3"],
          ["sendPhone1", "sendPhone2", "sendPhone3"],
        );
        setValue("limit_wg", weightCode);
        setValue("limit_vol", sizeCode);
        setValue("packSer", weightCode);
        setValue("packSerSel", weightCode);
        setValue("productCodeCombo", productCode);
        setValue("maincontcd", productCode);
        setValue("cont", itemName);
        setValue("demand", request.requestMemo || "");
        setValue("gCnt", "1");
        setRadio("sendPrsnMeetYn", "X");
        setValue("reportMethod", request.payment.methodNew || "3");
        setValue(
          "wishReceiptTimeInterval",
          request.pickup.wishReceiptTimeInterval || "09001600",
        );
        setValue("newPostNum0", pickup.zipCode);
        setValue("labpostNum0", pickup.zipCode);
        setValue("newSendPostNum0", pickup.zipCode);
        setValue("newRePostNum0", receiver.zipCode);
        setValue("creditNo1", cardNumber.slice(0, 4).trim());
        setValue("creditNo2", cardNumber.slice(4, 8).trim());
        setValue("creditNo3", cardNumber.slice(8, 12).trim());
        setValue("creditNo4", cardNumber.slice(12, 16).trim());
        setValue("creditExp1", credentials.cardExpMmYy.slice(0, 2));
        setValue("creditExp2", credentials.cardExpMmYy.slice(2, 4));
        setValue("creditPwd1", cardPassword.slice(0, 1));
        setValue("creditPwd2", cardPassword.slice(1, 2));
        setValue("creditBirth", digits(credentials.cardBirthOrBusinessNumber));
      },
      { request, credentials },
    );
  }
  async verifyFields(page, request) {
    const result = await page.evaluate(
      ({ request }) => {
        const doc = globalThis.document;
        const value = (nameOrId) => {
          const element =
            doc.getElementById(nameOrId) ??
            doc.querySelector(`[name="${nameOrId}"]`);
          return String(element?.value ?? "").trim();
        };
        const digits = (input) => String(input ?? "").replace(/[^0-9]/g, "");
        const pickup = request.pickup.from;
        const receiver = request.receiver;
        const phoneValue = (field, mobile, phone) =>
          (field === "MOBILE" ? mobile : phone).map(value).join("");
        const pickupPhoneField = pickup.phoneField ?? "MOBILE";
        const receiverPhoneField = receiver.phoneField ?? "MOBILE";
        const applicantPhone = phoneValue(
          pickupPhoneField,
          ["cell1", "labmobile_num", "cell3"],
          ["phone1", "phone2", "phone3"],
        );
        const receiverPhone = phoneValue(
          receiverPhoneField,
          ["reCell1", "reCell2", "reCell3"],
          ["rePhone1", "rePhone2", "rePhone3"],
        );
        const checks = {
          applicantName: value("labname") === String(pickup.name ?? "").trim(),
          applicantZip: digits(value("newPostNum")) === digits(pickup.zipCode),
          applicantAddress:
            value("postAddr") === String(pickup.address ?? "").trim(),
          applicantDetailAddress:
            value("detailAddr") === String(pickup.detailAddress ?? "").trim(),
          applicantPhone: digits(applicantPhone) === digits(pickup.phone),
          receiverName:
            value("receiverName") === String(receiver.name ?? "").trim(),
          receiverZip:
            digits(value("newRePostNum")) === digits(receiver.zipCode),
          receiverAddress:
            value("rePostAddr") === String(receiver.address ?? "").trim(),
          receiverDetailAddress:
            value("reDetailAddr") ===
            String(receiver.detailAddress ?? "").trim(),
          receiverPhone: digits(receiverPhone) === digits(receiver.phone),
        };
        return {
          ok: Object.values(checks).every(Boolean),
          failed: Object.entries(checks)
            .filter(([, passed]) => !passed)
            .map(([name]) => name),
          phoneDiagnostics: {
            applicantExpectedLength: digits(pickup.phone).length,
            applicantField: pickupPhoneField,
            applicantPartLengths: [
              ...(pickupPhoneField === "MOBILE"
                ? [
                    value("cell1").length,
                    (value("labmobile_num") || value("cell2")).length,
                    value("cell3").length,
                  ]
                : [
                    value("phone1").length,
                    value("phone2").length,
                    value("phone3").length,
                  ]),
            ],
            receiverExpectedLength: digits(receiver.phone).length,
            receiverField: receiverPhoneField,
            receiverPartLengths: [
              ...(receiverPhoneField === "MOBILE"
                ? [
                    value("reCell1").length,
                    value("reCell2").length,
                    value("reCell3").length,
                  ]
                : [
                    value("rePhone1").length,
                    value("rePhone2").length,
                    value("rePhone3").length,
                  ]),
            ],
          },
        };
      },
      { request },
    );
    if (!result.ok) {
      throw new Error(
        `우체국 접수 폼에 주문 주소를 반영하지 못했습니다. fields=${result.failed.join(",")}, phoneShape=${JSON.stringify(result.phoneDiagnostics)}`,
      );
    }
  }
  async waitForForm(page, timeoutMs) {
    await page
      .waitForLoadState("networkidle", {
        timeout: Math.min(timeoutMs, 20_000),
      })
      .catch(() => undefined);
    try {
      await page.waitForFunction(
        () => {
          const win = globalThis;
          const form = win.document?.getElementById("genAmtForm");
          return Boolean(
            form &&
            typeof win.refreshWishDayTime === "function" &&
            typeof win.refreshWishTime === "function" &&
            typeof win.dataProvider?.getRowCount === "function",
          );
        },
        null,
        { timeout: timeoutMs },
      );
    } catch (error) {
      const pageError = await page
        .evaluate(() => {
          const doc = globalThis.document;
          const text = String(doc?.body?.innerText ?? "")
            .replace(/\s+/g, " ")
            .slice(0, 500);
          if (
            /500\s*:\s*Internal error/i.test(text) ||
            text.includes("현재 서비스의 상태가 원활하지 않습니다") ||
            text.includes("시스템 오류로 인해 페이지를 표시할 수 없습니다")
          ) {
            return "우체국 사이트가 오류 페이지(HTTP 500)를 반환했습니다.";
          }
          return null;
        })
        .catch(() => null);
      if (pageError) {
        throw new Error(
          `우체국 선결제 접수 화면을 열 수 없습니다. ${pageError}`,
        );
      }
      const readiness = await page
        .evaluate(() => {
          const win = globalThis;
          const form = win.document?.getElementById("genAmtForm");
          const missing = [
            !form ? "접수폼" : null,
            typeof win.refreshWishDayTime !== "function"
              ? "방문일 조회 스크립트"
              : null,
            typeof win.refreshWishTime !== "function"
              ? "방문시간 조회 스크립트"
              : null,
            typeof win.dataProvider?.getRowCount !== "function"
              ? "수거지 목록 스크립트"
              : null,
          ].filter((value) => Boolean(value));
          return { missing };
        })
        .catch(() => ({ missing: ["페이지 진단 불가"] }));
      throw new Error(
        `우체국 선결제 접수 화면 초기화에 실패했습니다. 누락 요소: ${readiness.missing.join(", ") || "확인 불가"}`,
      );
    }
  }
  async selectSchedule(page, request, timeoutMs) {
    const requestedDate = String(request.pickup?.requestedDate ?? "");
    const requestedDateIso = String(request.pickup?.requestedDateIso ?? "");
    const preferredTime = String(request.pickup?.wishReceiptTime ?? "");
    const preferredInterval = String(
      request.pickup?.wishReceiptTimeInterval ?? "",
    );
    const fallbackToEarliestAvailableDate = this.allowDateFallback();
    const pickupZipCode = String(request.pickup?.from?.zipCode ?? "").replace(
      /[^0-9]/g,
      "",
    );
    await page.evaluate(
      ({ pickupZipCode }) => {
        const win = globalThis;
        const doc = win.document;
        win.arrWishDay = [];
        win.arrWishTime = [];
        const wishDayZip = doc.querySelector(
          '#frmGetWishDayList [name="zipcd"]',
        );
        if (wishDayZip) wishDayZip.value = pickupZipCode;
        const daySelect = doc.querySelector("#labwishReceiptTime");
        const timeSelect = doc.querySelector("#labwishReceiptTimeNm");
        if (daySelect) daySelect.innerHTML = "";
        if (timeSelect) timeSelect.innerHTML = "";
        if (typeof win.refreshWishDayTime === "function") {
          win.refreshWishDayTime();
        }
      },
      { pickupZipCode },
    );
    await page.waitForFunction(
      ({ pickupZipCode }) => {
        const doc = globalThis.document;
        const requestedZip = String(
          doc.querySelector('#frmGetWishDayList [name="zipcd"]')?.value ?? "",
        ).replace(/[^0-9]/g, "");
        return (
          Array.from(doc.querySelectorAll("#labwishReceiptTime option")).some(
            (option) => {
              const value = String(option.value ?? "").trim();
              const text = option.textContent?.trim() ?? "";
              return Boolean(value && value !== "선택") || /\d/.test(text);
            },
          ) && requestedZip === pickupZipCode
        );
      },
      { pickupZipCode },
      { timeout: timeoutMs },
    );
    const dayResult = await page.evaluate(
      ({
        requestedDate,
        requestedDateIso,
        fallbackToEarliestAvailableDate,
      }) => {
        const win = globalThis;
        const doc = win.document;
        const select = doc.querySelector("#labwishReceiptTime");
        if (!select) return { ok: false, reason: "date_select_missing" };
        const normalize = (value) => value.replace(/[^0-9]/g, "");
        const options = Array.from(select.options).map((option, index) => ({
          index,
          value: option.value,
          text: option.textContent?.trim() ?? "",
          normalized: normalize(`${option.value} ${option.textContent ?? ""}`),
        }));
        const target = normalize(requestedDate || requestedDateIso);
        const availableOptions = options.filter((option) => {
          const value = String(option.value ?? "").trim();
          return Boolean(value && value !== "선택");
        });
        const requestedMatch = target
          ? availableOptions.find((option) =>
              option.normalized.includes(target),
            )
          : null;
        const match =
          requestedMatch ??
          (!target || fallbackToEarliestAvailableDate
            ? availableOptions[0]
            : undefined);
        if (!match || match.value === "선택") {
          return { ok: false, reason: "date_option_missing", options };
        }
        select.selectedIndex = match.index;
        select.value = match.value;
        win.arrWishTime = [];
        const timeSelect = doc.querySelector("#labwishReceiptTimeNm");
        if (timeSelect) timeSelect.innerHTML = "";
        if (typeof win.refreshWishTime === "function") {
          win.refreshWishTime();
        }
        return {
          ok: true,
          selected: match,
          selectedDate: match.value || match.text,
          options,
          fallbackApplied: Boolean(target && !requestedMatch),
        };
      },
      {
        requestedDate,
        requestedDateIso,
        fallbackToEarliestAvailableDate,
      },
    );
    if (!dayResult?.ok) {
      const availableDates = Array.from(
        new Set(
          (Array.isArray(dayResult?.options) ? dayResult.options : [])
            .map((option) => {
              const value =
                typeof option.value === "string" ||
                typeof option.value === "number"
                  ? String(option.value)
                  : "";
              const text =
                typeof option.text === "string" ||
                typeof option.text === "number"
                  ? String(option.text)
                  : "";
              const normalizedValue = this.normalizeDate(value);
              return normalizedValue.length === 8
                ? normalizedValue
                : this.normalizeDate(text);
            })
            .filter(Boolean),
        ),
      ).slice(0, 14);
      throw new Error(
        `우체국 방문접수일자 선택에 실패했습니다. requestedDate=${requestedDate}, reason=${dayResult?.reason ?? "unknown"}, availableDates=${availableDates.join(",") || "없음"}`,
      );
    }
    await page.waitForFunction(
      ({ selectedDate }) => {
        const doc = globalThis.document;
        const responseDate = String(
          doc.querySelector('#frmGetWishTimeList [name="resDate"]')?.value ??
            "",
        );
        return (
          Array.from(doc.querySelectorAll("#labwishReceiptTimeNm option")).some(
            (option) => {
              const value = String(option.value ?? "").trim();
              const text = option.textContent?.trim() ?? "";
              return Boolean(value && value !== "선택") || /\d/.test(text);
            },
          ) && responseDate === selectedDate
        );
      },
      { selectedDate: dayResult.selectedDate },
      { timeout: timeoutMs },
    );
    const timeResult = await page.evaluate(
      ({ preferredTime, preferredInterval, selectedDate }) => {
        const win = globalThis;
        const doc = win.document;
        const select = doc.querySelector("#labwishReceiptTimeNm");
        if (!select) return { ok: false, reason: "time_select_missing" };
        const normalize = (value) => value.replace(/[^0-9]/g, "");
        const options = Array.from(select.options)
          .map((option, index) => ({
            index,
            value: option.value,
            text: option.textContent?.trim() ?? "",
            normalized: normalize(
              `${option.value} ${option.textContent ?? ""}`,
            ),
          }))
          .filter((option) => option.value && option.value !== "선택");
        const interval = normalize(preferredInterval);
        const time = normalize(preferredTime);
        const match =
          (interval
            ? options.find((option) => option.normalized.includes(interval))
            : null) ??
          (time
            ? options.find((option) => option.normalized.includes(time))
            : null) ??
          (!interval && !time ? options[0] : undefined);
        if (!match) return { ok: false, reason: "time_option_missing" };
        select.selectedIndex = match.index;
        select.value = match.value;
        select.dispatchEvent(new win.Event("input", { bubbles: true }));
        select.dispatchEvent(new win.Event("change", { bubbles: true }));
        const selectedTime = match.value || match.text;
        const timeRows = Array.isArray(win.arrWishTime) ? win.arrWishTime : [];
        const row =
          timeRows.find((candidate) => candidate?.[7] === selectedTime) ??
          timeRows[0];
        const intervalCode =
          row?.[8] && row?.[9] ? `${row[8]}${row[9]}` : normalize(selectedTime);
        const pickMan = row?.[10] ?? "";
        const pickArea = row?.[11] ?? "";
        const pickParty = row?.[12] ?? "";
        const finalDate = String(selectedDate || "").trim();
        win.__epostAutomationWishSchedule = {
          wishReceiptTime: finalDate,
          wishReceiptTimeInterval: intervalCode,
          pickParty,
          pickArea,
          pickMan,
          wishReceiptTimeNm: selectedTime,
        };
        if (typeof win.putValue === "function") {
          win.putValue([
            finalDate,
            intervalCode,
            pickParty,
            pickArea,
            pickMan,
            selectedTime,
          ]);
        }
        const assignFormValue = (form, name, value) => {
          if (!form || value == null) return;
          if (form[name]) form[name].value = value;
          const el = doc.getElementById(name);
          if (el) el.value = value;
        };
        const form = doc.getElementById("genAmtForm");
        if (form) {
          assignFormValue(form, "wishReceiptTime", finalDate);
          assignFormValue(form, "hopeRceptDe", finalDate);
          assignFormValue(form, "hopeReceiptDate", finalDate);
          assignFormValue(form, "wishReceiptTimeText", finalDate);
          assignFormValue(form, "wishReceiptTimeInterval", intervalCode);
          assignFormValue(form, "pickParty", pickParty);
          assignFormValue(form, "pickArea", pickArea);
          assignFormValue(form, "pickMan", pickMan);
          assignFormValue(form, "wishReceiptTimeNm", selectedTime);
        }
        const submitForm = doc.getElementById("rForm");
        if (submitForm) {
          submitForm.r_wishReceiptTime.value = finalDate;
          submitForm.r_wishReceiptTimeInterval.value = intervalCode;
          submitForm.r_pickParty.value = pickParty;
          submitForm.r_pickArea.value = pickArea;
          submitForm.r_pickMan.value = pickMan;
        }
        return {
          ok: true,
          selected: match,
          wishReceiptTime: form?.wishReceiptTime?.value ?? "",
          wishReceiptTimeInterval: form?.wishReceiptTimeInterval?.value ?? "",
          pickParty: form?.pickParty?.value ?? "",
          pickArea: form?.pickArea?.value ?? "",
          pickMan: form?.pickMan?.value ?? "",
        };
      },
      {
        preferredTime,
        preferredInterval,
        selectedDate: dayResult.selectedDate,
      },
    );
    if (!timeResult?.ok) {
      throw new Error(
        `우체국 방문신청시간 선택에 실패했습니다. requestedDate=${requestedDate}, reason=${timeResult?.reason ?? "unknown"}`,
      );
    }
    const pickupRequestedDate = this.normalizeDate(
      String(dayResult.selectedDate ?? ""),
    );
    if (!pickupRequestedDate) {
      throw new Error("우체국 방문신청일자를 정상화하지 못했습니다.");
    }
    return {
      pickupRequestedDate: this.toIsoDateString(pickupRequestedDate),
      wishReceiptTime: String(timeResult.wishReceiptTime ?? ""),
      wishReceiptTimeInterval: String(timeResult.wishReceiptTimeInterval ?? ""),
      fallbackApplied: Boolean(dayResult.fallbackApplied),
    };
  }
  async addRecipient(page, request, messages, timeoutMs) {
    const started = await page.evaluate(() => {
      const win = globalThis;
      const provider = win.dataProvider;
      const before =
        typeof provider?.getRowCount === "function"
          ? provider.getRowCount()
          : -1;
      if (before !== 0) {
        return {
          ok: false,
          reason: "recipient_grid_not_empty",
          before,
        };
      }
      const schedule = win.__epostAutomationWishSchedule ?? {};
      const wishDate = String(schedule.wishReceiptTime ?? "").trim();
      const wishTime = String(schedule.wishReceiptTimeNm ?? "").trim();
      if (!wishDate || !wishTime) {
        return {
          ok: false,
          reason: "recipient_schedule_missing",
          before,
        };
      }
      win.getWishDay = () => wishDate;
      win.getWishTime = () => wishTime;
      if (typeof win.eval === "function") {
        win.eval(
          `getWishDay = function(){ return ${JSON.stringify(wishDate)}; }; getWishTime = function(){ return ${JSON.stringify(wishTime)}; };`,
        );
      }
      win.pickYN = "Y";
      const addButton = win.document?.getElementById("imgBtn");
      if (typeof addButton?.click === "function") {
        addButton.click();
        return {
          ok: true,
          action: "native_add_button",
          returnedFalse: false,
          before,
        };
      }
      if (typeof win.selectType !== "function") {
        return {
          ok: false,
          reason: "recipient_builder_missing",
          before,
        };
      }
      const result = win.selectType();
      return {
        ok: true,
        action: "legacy_select_type",
        returnedFalse: result === false,
        before,
      };
    });
    if (!started.ok) {
      throw new Error(
        `우체국 받는 분 목록 추가에 실패했습니다. reason=${started.reason}, rowCount=${started.before}, messages=${messages
          .slice(-5)
          .map((message) => this.omitMessage(message))
          .join(" / ")}`,
      );
    }
    try {
      await page.waitForFunction(
        () => globalThis.dataProvider?.getRowCount?.() === 1,
        null,
        { timeout: timeoutMs },
      );
    } catch (error) {
      const diagnostics = await page
        .evaluate(() => {
          const win = globalThis;
          return {
            rowCount: win.dataProvider?.getRowCount?.() ?? -1,
            hasNativeAddButton:
              typeof win.document?.getElementById("imgBtn")?.click ===
              "function",
            hasLegacySelectType: typeof win.selectType === "function",
            hasGridView: Boolean(win.gridView),
          };
        })
        .catch(() => ({ rowCount: -1, diagnosticsUnavailable: true }));
      throw new Error(
        `우체국 받는 분 목록을 추가하지 못했습니다. action=${started.action ?? "unknown"}, returnedFalse=${Boolean(started.returnedFalse)}, rowCount=${diagnostics.rowCount}, nativeAddButton=${Boolean(diagnostics.hasNativeAddButton)}, legacySelectType=${Boolean(diagnostics.hasLegacySelectType)}, gridView=${Boolean(diagnostics.hasGridView)}, messages=${messages
          .slice(-5)
          .map((message) => this.omitMessage(message))
          .join(" / ")}`,
      );
    }
    const result = await page.evaluate(
      ({ request }) => {
        const win = globalThis;
        const provider = win.dataProvider;
        const rowCount = provider?.getRowCount?.() ?? 0;
        const row = provider?.getJsonRow?.(0) ?? {};
        const pickupPhoneField = request.pickup?.from?.phoneField ?? "MOBILE";
        const receiverPhoneField = request.receiver?.phoneField ?? "MOBILE";
        const pickupPhoneColumn =
          pickupPhoneField === "MOBILE" ? "girdCell" : "girdPhone";
        const receiverPhoneColumn =
          receiverPhoneField === "MOBILE" ? "gridReCell" : "gridRePhone";
        const digits = (value) => String(value ?? "").replace(/[^0-9]/g, "");
        const text = (value) => String(value ?? "").trim();
        const requiredFields = [
          "gridReName",
          "gridReZipcd",
          "gridRePostAddr",
          "gridCharge",
          "gridMethod",
          "gridLimit_wg",
          "gridLimit_vol",
          "gridPackSer",
          "gridLabProductCode",
          "gridLabcont",
          "gridCustName",
          "gridPostNum",
          "girdPostAddr",
          pickupPhoneColumn,
          "gridSendName",
          "gridSendZipcd",
          "girdSendPostAddr",
          pickupPhoneField === "MOBILE" ? "girdSendCell" : "girdSendPhone",
          receiverPhoneColumn,
        ];
        const missingFields = requiredFields.filter(
          (field) => String(row[field] ?? "").trim() === "",
        );
        const checks = {
          receiverName: text(row.gridReName) === text(request.receiver?.name),
          receiverZip:
            digits(row.gridReZipcd) === digits(request.receiver?.zipCode) &&
            digits(row.gridReZipcd).length === 5,
          receiverAddress:
            text(row.gridRePostAddr) === text(request.receiver?.address),
          receiverPhone:
            digits(row[receiverPhoneColumn]) ===
            digits(request.receiver?.phone),
          pickupName:
            text(row.gridCustName) === text(request.pickup?.from?.name),
          pickupZip:
            digits(row.gridPostNum) === digits(request.pickup?.from?.zipCode) &&
            digits(row.gridPostNum).length === 5,
          pickupAddress:
            text(row.girdPostAddr) === text(request.pickup?.from?.address),
          pickupPhone:
            digits(row[pickupPhoneColumn]) ===
            digits(request.pickup?.from?.phone),
        };
        const failedChecks = Object.entries(checks)
          .filter(([, passed]) => !passed)
          .map(([name]) => name);
        return {
          ok:
            rowCount === 1 &&
            missingFields.length === 0 &&
            failedChecks.length === 0,
          rowCount,
          missingFields,
          failedChecks,
          rowFieldCount: Object.keys(row).length,
          chargeConfigured: Boolean(String(row.gridCharge ?? "").trim()),
          methodConfigured: Boolean(String(row.gridMethod ?? "").trim()),
        };
      },
      { request },
    );
    if (!result.ok) {
      throw new Error(
        `우체국 받는 분 목록이 완성되지 않았습니다. rowCount=${result.rowCount}, missing=${result.missingFields.join(",")}, mismatch=${result.failedChecks.join(",")}, messages=${messages
          .slice(-5)
          .map((message) => this.omitMessage(message))
          .join(" / ")}`,
      );
    }
    return result;
  }
  async certifyCard(page, messages, timeoutMs) {
    const result = await page.evaluate(async () => {
      const win = globalThis;
      const doc = win.document;
      const form = doc.getElementById("cardForm");
      if (!form) {
        throw new Error("우체국 카드 검증 폼을 찾지 못했습니다.");
      }
      const formToUrlEncoded = (targetForm) => {
        const params = new win.URLSearchParams();
        for (const element of Array.from(targetForm.elements ?? [])) {
          if (!element?.name || element.disabled) continue;
          const type = String(element.type ?? "").toLowerCase();
          if ((type === "checkbox" || type === "radio") && !element.checked) {
            continue;
          }
          params.append(element.name, element.value ?? "");
        }
        return params.toString();
      };
      const encoded = formToUrlEncoded(form).replace(/%/g, "%25");
      const response = await win.fetch("general.RetrieveEasypayCert.parcel", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/xml,text/xml,*/*",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: encoded,
      });
      const text = await response.text();
      const xml = new win.DOMParser().parseFromString(text, "text/xml");
      const resultCode =
        xml.querySelector("resultcd")?.textContent?.trim() ??
        xml.querySelector("resultCd")?.textContent?.trim() ??
        "";
      const message =
        xml.querySelector("resultmsg")?.textContent?.trim() ??
        xml.querySelector("resultMsg")?.textContent?.trim() ??
        "";
      if (response.ok && resultCode === "0000") {
        win.CreditInfocheckval = true;
        win.CreditInfocheckfail = false;
        for (const selector of [
          "#creditNo1",
          "#creditNo2",
          "#creditNo3",
          "#creditNo4",
          "#creditExp1",
          "#creditExp2",
          "#creditBirth",
          "#creditPwd1",
          "#creditPwd2",
        ]) {
          const input = doc.querySelector(selector);
          if (input) input.readOnly = true;
        }
      } else {
        win.CreditInfocheckval = false;
        win.CreditInfocheckfail = true;
      }
      return {
        ok: response.ok && resultCode === "0000",
        status: response.status,
        resultCode,
        message,
      };
    });
    if (!result.ok) {
      const pgMessage =
        result.message ||
        (result.resultCode
          ? `우체국 카드 인증 응답 코드 ${result.resultCode}. 카드번호, 유효기간, 카드 비밀번호 앞 2자리, 생년월일/사업자번호를 확인해주세요.`
          : messages.slice(-3).join(" / "));
      throw new Error(
        `우체국 선결제 카드 검증에 실패했습니다. status=${result.status}, result=${result.resultCode || "unknown"}, message=${pgMessage}`,
      );
    }
    return result;
  }
  async submitReservation(page, request, messages, timeoutMs) {
    const resolvedRequestedDate = this.normalizeDate(
      request?.pickup?.requestedDate ??
        request?.pickupRequestedDate ??
        request?.pickup?.requestedDateIso ??
        request?.requestedDate ??
        "",
    );
    const resolvedRequestedDateIso =
      request?.pickup?.requestedDateIso ||
      (resolvedRequestedDate
        ? this.toIsoDateString(resolvedRequestedDate)
        : "");
    if (!resolvedRequestedDate) {
      throw new Error(
        `우체국 선결제 예약 제출 날짜를 확인하지 못했습니다. requestKeys=${Object.keys(request ?? {}).join(",")}, pickupKeys=${Object.keys(request?.pickup ?? {}).join(",")}`,
      );
    }
    const result = await page.evaluate(
      async ({ requestedDate, requestedDateIso }) => {
        const win = globalThis;
        const doc = win.document;
        const form = doc.getElementById("genAmtForm");
        const rForm = doc.getElementById("rForm");
        const cardForm = doc.getElementById("cardForm");
        if (!form || !rForm || !cardForm) {
          throw new Error("우체국 선결제 접수 폼을 찾지 못했습니다.");
        }
        const gForm = form;
        const finalForm = rForm;
        const checkedValue = (name) =>
          doc.querySelector(`input[type="radio"][name="${name}"]:checked`)
            ?.value ?? "";
        const value = (selector) => doc.querySelector(selector)?.value ?? "";
        const formValue = (form, name) => {
          const elements = Array.from(
            form.querySelectorAll(`[name="${name}"]`),
          );
          return (
            elements
              .map((element) => String(element.value ?? "").trim())
              .find(Boolean) ?? ""
          );
        };
        const ensureFormValue = (form, name, value) => {
          const elements = Array.from(
            form.querySelectorAll(`[name="${name}"]`),
          );
          for (const element of elements) element.value = value ?? "";
          if (elements.length === 0 || formValue(form, name) !== value) {
            const input = doc.createElement("input");
            input.type = "hidden";
            input.name = name;
            input.value = value ?? "";
            form.appendChild(input);
          }
        };
        const cardField = (name) =>
          Array.from(cardForm.querySelectorAll(`input[name^="${name}"]`))
            .filter((input) => input.id !== "creditExpNow")
            .map((input) => input.value.trim())
            .join("");
        const cardExpForReservation = () =>
          Array.from(cardForm.querySelectorAll('input[name^="creditExp"]'))
            .filter((input) => input.id !== "creditExpNow")
            .map((input) => input.value.trim())
            .reduce((value, part) => `${part}${value}`, "");
        const normalizeWebDate = (value) => {
          const digits = String(value ?? "").replace(/[^0-9]/g, "");
          return digits.length >= 8
            ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
            : value;
        };
        const finalWishDateRaw =
          gForm.wishReceiptTime?.value ||
          gForm.hopeRceptDe?.value ||
          gForm.hopeReceiptDate?.value ||
          doc.querySelector('[name="wishReceiptDate"]')?.value ||
          win.__epostAutomationWishSchedule?.wishReceiptTime ||
          finalForm.r_wishReceiptTime?.value ||
          requestedDate ||
          requestedDateIso ||
          "";
        const finalWishDate = normalizeWebDate(finalWishDateRaw);
        const finalWishInterval =
          gForm.wishReceiptTimeInterval?.value ||
          win.__epostAutomationWishSchedule?.wishReceiptTimeInterval ||
          finalForm.r_wishReceiptTimeInterval?.value ||
          "";
        const finalPickParty =
          gForm.pickParty?.value ||
          win.__epostAutomationWishSchedule?.pickParty ||
          finalForm.r_pickParty?.value ||
          "";
        const finalPickArea =
          gForm.pickArea?.value ||
          win.__epostAutomationWishSchedule?.pickArea ||
          finalForm.r_pickArea?.value ||
          "";
        const finalPickMan =
          gForm.pickMan?.value ||
          win.__epostAutomationWishSchedule?.pickMan ||
          finalForm.r_pickMan?.value ||
          "";
        if (finalWishDate) {
          ensureFormValue(gForm, "wishReceiptTime", finalWishDate);
          ensureFormValue(gForm, "hopeRceptDe", finalWishDate);
          ensureFormValue(gForm, "hopeReceiptDate", finalWishDate);
          const wishDate = doc.querySelector('[name="wishReceiptDate"]');
          if (wishDate) wishDate.value = finalWishDate;
        }
        if (!formValue(gForm, "wishReceiptTime")) {
          throw new Error("희망방문접수일이 비어 있습니다.");
        }
        finalForm.sendMailYn.value = "N";
        finalForm.r_wishReceiptTime.value = finalWishDate;
        finalForm.r_wishReceiptTimeInterval.value = finalWishInterval;
        finalForm.r_pickParty.value = finalPickParty;
        finalForm.r_pickArea.value = finalPickArea;
        finalForm.r_pickMan.value = finalPickMan;
        ensureFormValue(finalForm, "wishReceiptTime", finalWishDate);
        ensureFormValue(finalForm, "hopeRceptDe", finalWishDate);
        ensureFormValue(finalForm, "hopeReceiptDate", finalWishDate);
        ensureFormValue(
          finalForm,
          "wishReceiptTimeInterval",
          finalWishInterval,
        );
        ensureFormValue(
          finalForm,
          "wishReceiptTimeNm",
          win.__epostAutomationWishSchedule?.wishReceiptTimeNm ?? "",
        );
        ensureFormValue(finalForm, "pickParty", finalPickParty);
        ensureFormValue(finalForm, "pickArea", finalPickArea);
        ensureFormValue(finalForm, "pickMan", finalPickMan);
        const charge = checkedValue("charge") || "001";
        const method = checkedValue("method") || "1";
        finalForm.payMethCd.value = charge;
        finalForm.methodNew.value = method;
        finalForm.pickupKeep.value = value('select[name="pickupKeep"]');
        finalForm.pickupKeepNm.value = value('input[name="pickupKeepNm"]');
        finalForm.mobilReceipt.value = "N";
        if (charge === "003") {
          finalForm.payMeth.value = "2";
          finalForm.prcPayMethCd.value = "16";
        } else {
          finalForm.payMeth.value = "1";
          finalForm.prcPayMethCd.value = "10";
        }
        finalForm.creditNo.value = cardField("creditNo");
        finalForm.creditExp.value = cardExpForReservation();
        finalForm.creditBirth.value =
          cardForm.querySelector("#creditBirth")?.value?.trim() ?? "";
        finalForm.creditPwd.value = cardField("creditPwd");
        finalForm.method = "post";
        finalForm.target = "_self";
        finalForm.action =
          "https://parcel.epost.go.kr/general.InsertNewGeneralReserve.parcel";
        const submitCandidates = Array.from(
          doc.querySelectorAll(
            'button, input[type="button"], input[type="submit"], a',
          ),
        )
          .map((element) => ({
            tagName: element.tagName,
            id: element.id ?? "",
            name: element.name ?? "",
            type: element.type ?? "",
            value: element.value ?? "",
            text: element.textContent?.trim() ?? "",
            onclick: String(element.getAttribute?.("onclick") ?? "").slice(
              0,
              120,
            ),
          }))
          .filter((candidate) =>
            /접수|신청|예약|결제|submit|reserve|Reserve|rForm|InsertNewGeneralReserve/i.test(
              [
                candidate.id,
                candidate.name,
                candidate.value,
                candidate.text,
                candidate.onclick,
              ].join(" "),
            ),
          )
          .slice(0, 12);
        return {
          ok: true,
          status: 200,
          finalUrl: globalThis.location.href,
          title: doc.title,
          snapshot: {
            requestedDate,
            requestedDateIso,
            finalWishDate,
            finalWishInterval,
            finalPickParty: Boolean(finalPickParty),
            finalPickArea: Boolean(finalPickArea),
            finalPickMan: Boolean(finalPickMan),
            genAmtForm: {
              wishReceiptTime: formValue(gForm, "wishReceiptTime"),
              hopeRceptDe: formValue(gForm, "hopeRceptDe"),
              hopeReceiptDate: formValue(gForm, "hopeReceiptDate"),
              wishReceiptTimeInterval: formValue(
                gForm,
                "wishReceiptTimeInterval",
              ),
            },
            rForm: {
              r_wishReceiptTime: finalForm.r_wishReceiptTime?.value ?? "",
              r_wishReceiptTimeInterval:
                finalForm.r_wishReceiptTimeInterval?.value ?? "",
              wishReceiptTime:
                finalForm.querySelector('[name="wishReceiptTime"]')?.value ??
                "",
              hopeRceptDe:
                finalForm.querySelector('[name="hopeRceptDe"]')?.value ?? "",
              hopeReceiptDate:
                finalForm.querySelector('[name="hopeReceiptDate"]')?.value ??
                "",
              wishReceiptTimeInterval:
                finalForm.querySelector('[name="wishReceiptTimeInterval"]')
                  ?.value ?? "",
              action: finalForm.action,
              method: finalForm.method,
              fields: Array.from(finalForm.elements ?? [])
                .filter((element) => element?.name)
                .map((element) => ({
                  name: String(element.name),
                  value:
                    /credit|card|birth|pwd|password|phone|cell|tel|name|addr|post|zip|email/i.test(
                      String(element.name),
                    )
                      ? `[redacted:length=${String(element.value ?? "").length}]`
                      : String(element.value ?? "").slice(0, 120),
                })),
            },
            submitCandidates,
          },
        };
      },
      {
        requestedDate: resolvedRequestedDate,
        requestedDateIso: resolvedRequestedDateIso,
      },
    );
    if (!result.ok) {
      throw new Error(
        `우체국 선결제 예약 제출 HTTP ${result.status}: ${messages
          .slice(-3)
          .join(" / ")}`,
      );
    }
    let submitAction = null;
    let navigationObserved = false;
    await Promise.all([
      page
        .waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        })
        .then(() => {
          navigationObserved = true;
        })
        .catch(() => undefined),
      page
        .evaluate(() => {
          const win = globalThis;
          const doc = win.document;
          const form = doc.getElementById("rForm");
          if (!form)
            throw new Error("우체국 선결제 최종 제출 폼을 찾지 못했습니다.");
          const describe = (element) =>
            element
              ? {
                  tagName: element.tagName,
                  id: element.id ?? "",
                  name: element.name ?? "",
                  type: element.type ?? "",
                  value: element.value ?? "",
                  text: element.textContent?.trim() ?? "",
                  onclick: String(
                    element.getAttribute?.("onclick") ?? "",
                  ).slice(0, 120),
                }
              : null;
          const target =
            doc.getElementById("reqBtn") ||
            form.querySelector(
              'button, input[type="button"], input[type="submit"], a',
            );
          const genAmtForm = doc.getElementById("genAmtForm");
          const finalWishDate =
            form.querySelector('[name="wishReceiptTime"]')?.value ||
            form.querySelector('[name="hopeRceptDe"]')?.value ||
            form.r_wishReceiptTime?.value ||
            genAmtForm?.wishReceiptTime?.value ||
            "";
          const finalWishInterval =
            form.querySelector('[name="wishReceiptTimeInterval"]')?.value ||
            form.r_wishReceiptTimeInterval?.value ||
            genAmtForm?.wishReceiptTimeInterval?.value ||
            "";
          win.saveFlg = "F";
          const wishTimeName =
            win.__epostAutomationWishSchedule?.wishReceiptTimeNm ||
            form.querySelector('[name="wishReceiptTimeNm"]')?.value ||
            genAmtForm?.wishReceiptTimeNm?.value ||
            finalWishInterval;
          const finalWishTime =
            String(wishTimeName || "").trim() ||
            String(finalWishInterval || "");
          const restoreWishSelects = () => {
            const showElement = (element) => {
              if (!element) return;
              element.disabled = false;
              element.style.display = "inline-block";
              element.style.visibility = "visible";
              element.style.opacity = "1";
            };
            const ensureOption = (select, value, text) => {
              if (!select || !value) return;
              const exists = Array.from(select.options ?? []).some(
                (option) => String(option.value ?? "") === value,
              );
              if (!exists) {
                const option = doc.createElement("option");
                option.value = value;
                option.textContent = text || value;
                select.appendChild(option);
              }
              select.value = value;
            };
            const daySelect = doc.querySelector("#labwishReceiptTime");
            const timeSelect = doc.querySelector("#labwishReceiptTimeNm");
            showElement(daySelect);
            showElement(timeSelect);
            showElement(daySelect?.parentElement);
            showElement(timeSelect?.parentElement);
            ensureOption(daySelect, finalWishDate, finalWishDate);
            ensureOption(timeSelect, finalWishTime, wishTimeName);
            daySelect?.dispatchEvent(
              new win.Event("change", { bubbles: true }),
            );
            timeSelect?.dispatchEvent(
              new win.Event("change", { bubbles: true }),
            );
          };
          restoreWishSelects();
          if (typeof win.tempSave === "function") {
            const originalTempSave = win.tempSave;
            win.tempSave = function (...args) {
              const value = originalTempSave.apply(this, args);
              restoreWishSelects();
              return value;
            };
          }
          win.getWishDay = () => finalWishDate;
          win.getWishTime = () => finalWishTime;
          if (typeof win.eval === "function") {
            win.eval(
              `getWishDay = function(){ return ${JSON.stringify(finalWishDate)}; }; getWishTime = function(){ return ${JSON.stringify(finalWishTime)}; };`,
            );
          }
          if (typeof win.reqBtn !== "function") {
            throw new Error("우체국 예약 신청 함수를 찾지 못했습니다.");
          }
          win.reqBtn();
          return {
            strategy: "reqBtn",
            target: describe(target),
            action: form.action,
            method: form.method,
            getWishDay: win.getWishDay(),
            getWishTime: win.getWishTime(),
          };
        })
        .then((value) => {
          submitAction = value;
        })
        .catch((error) => {
          submitAction = {
            strategy: "failed",
            message: String(error?.message ?? error),
          };
        }),
    ]);
    await page
      .waitForLoadState("domcontentloaded", { timeout: timeoutMs })
      .catch(() => undefined);
    await page.waitForTimeout(2_000).catch(() => undefined);
    const bodyText = await page
      .locator("body")
      .innerText({ timeout: 3_000 })
      .catch(() => "");
    if (!navigationObserved) {
      throw new Error(
        `우체국 희망방문시간 검증 후 접수 화면으로 이동하지 못했습니다. ${messages
          .slice(-5)
          .join(" / ")}, finalSubmit=${JSON.stringify({
          setup: result.snapshot,
          action: submitAction,
        })}`,
      );
    }
    const finalBodyText = await page
      .locator("body")
      .innerText({ timeout: 3_000 })
      .catch(() => bodyText);
    if (
      /오류|실패|불가|확인 후|다시/.test(finalBodyText) &&
      !/완료|접수/.test(finalBodyText)
    ) {
      throw new Error(
        `우체국 선결제 예약 제출에 실패했습니다. ${messages
          .slice(-3)
          .join(" / ")}, finalSubmit=${JSON.stringify({
          setup: result.snapshot,
          action: submitAction,
        })}`,
      );
    }
    return {
      setup: result.snapshot,
      action: submitAction,
      navigationObserved,
    };
  }
  async loadReservations(page, reservationUrl, externalRequestId, timeoutMs) {
    await page.goto(reservationUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await page
      .waitForLoadState("networkidle", {
        timeout: Math.min(timeoutMs, 20_000),
      })
      .catch(() => undefined);
    const reservationDate = /^\d{8}/.exec(externalRequestId)?.[0] ?? "";
    if (!reservationDate) return;
    const currentDate = await page.evaluate(() => {
      const form = globalThis.document?.getElementById("retrieveResFrm");
      return String(form?.recDateStart?.value ?? "");
    });
    if (currentDate === reservationDate) return;
    await Promise.all([
      page
        .waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        })
        .catch(() => undefined),
      page.evaluate(
        ({ reservationDate, reservationUrl }) => {
          const win = globalThis;
          const doc = win.document;
          const form = doc.getElementById("retrieveResFrm");
          if (!form) {
            throw new Error("우체국 예약 조회 폼을 찾지 못했습니다.");
          }
          const setValue = (name, value) => {
            const element = form.querySelector(`[name="${name}"]`);
            if (element) element.value = value;
          };
          setValue("recDateStart", reservationDate);
          setValue("recDateEnd", reservationDate);
          setValue("fromYear", reservationDate.slice(0, 4));
          setValue("fromMonth", reservationDate.slice(4, 6));
          setValue("fromDay", reservationDate.slice(6, 8));
          setValue("toYear", reservationDate.slice(0, 4));
          setValue("toMonth", reservationDate.slice(4, 6));
          setValue("toDay", reservationDate.slice(6, 8));
          form.action =
            new win.URL(reservationUrl).origin +
            new win.URL(reservationUrl).pathname;
          form.method = "post";
          form.target = "_self";
          win.HTMLFormElement.prototype.submit.call(form);
        },
        { reservationDate, reservationUrl },
      ),
    ]);
    await page
      .waitForLoadState("networkidle", {
        timeout: Math.min(timeoutMs, 20_000),
      })
      .catch(() => undefined);
  }
  async waitForDetail(page, externalRequestId, timeoutMs) {
    try {
      await page.waitForFunction(
        ({ externalRequestId }) => {
          const win = globalThis;
          const frame = win.resAmtDetail;
          const doc = frame?.document;
          return (
            String(win.resSer ?? "") === externalRequestId &&
            typeof frame?.chkCount === "function" &&
            typeof frame?.getDisabledCheck === "function" &&
            doc?.readyState === "complete" &&
            doc.getElementsByName("yn").length > 0
          );
        },
        { externalRequestId },
        { timeout: Math.min(timeoutMs, 15_000) },
      );
    } catch {
      const detailState = await this.inspectDetail(page).catch(() => null);
      const detailSummary = detailState
        ? ` total=${detailState.totalCount}, cancelable=${detailState.cancelableCount}, disabled=${detailState.disabledCount}`
        : "";
      throw new Error(
        `우체국 예약 취소 상세 항목을 불러오지 못했습니다.${detailSummary}`,
      );
    }
  }
  async inspectDetail(page, selectCancelable = false) {
    return page.evaluate(
      ({ selectCancelable }) => {
        const win = globalThis;
        const frame = win.resAmtDetail;
        const doc = frame?.document;
        if (!doc) {
          throw new Error("우체국 예약 상세 화면을 찾지 못했습니다.");
        }
        const items = Array.from(doc.getElementsByName("yn"));
        const checkStates = Array.from(doc.getElementsByName("chkYn"));
        let cancelableCount = 0;
        for (const [index, item] of items.entries()) {
          if (item.disabled) continue;
          cancelableCount += 1;
          if (!selectCancelable) continue;
          if (!item.checked) item.click();
          item.checked = true;
          if (checkStates[index]) checkStates[index].value = "y";
        }
        return {
          totalCount: items.length,
          cancelableCount,
          selectedCount:
            typeof frame.chkCount === "function" ? frame.chkCount() : 0,
          disabledCount: items.filter((item) => item.disabled).length,
          siteDisabledCount:
            typeof frame.getDisabledCheck === "function"
              ? Number(frame.getDisabledCheck() ?? 0)
              : 0,
        };
      },
      { selectCancelable },
    );
  }
  async submitCancellation(page, cancelStrategy) {
    return page.evaluate(
      ({ cancelStrategy }) => {
        const win = globalThis;
        // `cancelRes()` reads its named child-frame reference again, which is
        // not stable under browser automation. Mirror its required form setup
        // before calling the final Korea Post page action directly.
        const cancelFunction =
          cancelStrategy === "individual" ? win.oneCancel : win.cancelResAmt;
        if (typeof cancelFunction !== "function") {
          throw new Error("우체국 예약 취소 함수를 찾지 못했습니다.");
        }
        if (cancelStrategy === "individual") {
          cancelFunction();
          return;
        }
        const form = win.document?.getElementById("retrieveResFrm");
        const serviceGubun =
          form?.serviceGubun ?? form?.elements?.namedItem?.("serviceGubun");
        const gubun =
          typeof win.getGubun === "function"
            ? String(win.getGubun() ?? "")
            : "";
        if (!serviceGubun || !gubun) {
          throw new Error(
            "우체국 예약 취소에 필요한 서비스 구분값을 찾지 못했습니다.",
          );
        }
        serviceGubun.value = gubun;
        cancelFunction("1");
      },
      { cancelStrategy },
    );
  }
  dismissInstallationDialog(message) {
    return (
      message.includes("보안프로그램을 설치") ||
      message.includes("설치 없이 이용")
    );
  }
  requiresPhoneVerification(message) {
    return (
      message.includes("받는 분의 휴대전화 중간자리") ||
      message.includes("휴대전화 중간자리를 4자리 숫자로 입력")
    );
  }
  async submitLogin(page, credentials, timeoutMs) {
    await page.evaluate(
      ({ loginId, loginPassword }) => {
        const doc = globalThis.document;
        const EventCtor = globalThis.Event;
        const setValue = (selector, value) => {
          const el = doc.querySelector(selector);
          if (!el) return false;
          el.value = value;
          el.dispatchEvent(new EventCtor("input", { bubbles: true }));
          el.dispatchEvent(new EventCtor("change", { bubbles: true }));
          return true;
        };
        const hasId = setValue('input[name="id"], input#id', loginId);
        const hasPassword = setValue(
          'input[name="passwd"], input#passwd, input[type="password"]',
          loginPassword,
        );
        if (!hasId || !hasPassword) {
          throw new Error("우체국 로그인 입력 필드를 찾지 못했습니다.");
        }
      },
      {
        loginId: credentials.loginId,
        loginPassword: credentials.loginPassword,
      },
    );
    await Promise.all([
      page
        .waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        })
        .catch(() => undefined),
      page.evaluate(() => {
        const win = globalThis;
        const doc = win.document;
        if (typeof win.checkVal === "function") {
          win.checkVal();
          return;
        }
        const form =
          doc.forms.namedItem("frmLogin") || doc.querySelector("form");
        form?.requestSubmit?.();
        if (form && !form.requestSubmit) form.submit();
      }),
    ]);
    await page
      .waitForLoadState("domcontentloaded", { timeout: timeoutMs })
      .catch(() => undefined);
    await page
      .waitForURL("https://parcel.epost.go.kr/**", {
        waitUntil: "domcontentloaded",
        timeout: Math.min(timeoutMs, 60_000),
      })
      .catch((error) => {
        throw new Error(
          `우체국 로그인 후 소포 서비스 세션 연결에 실패했습니다. ${this.errorMessage(error)}`,
        );
      });
  }
  stripUrlQuery(url) {
    try {
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return url.split("?")[0].split("#")[0];
    }
  }
  allowDateFallback() {
    return false;
  }
  normalizeDate(value) {
    const digits = this.onlyDigits(value);
    if (digits.length === 8) return digits;
    if (digits.length === 6) return `20${digits}`;
    return digits;
  }
  toIsoDateString(value) {
    return value.length === 8
      ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
      : value;
  }
  omitMessage(_message) {
    return "[site message omitted]";
  }
  errorMessage(_error) {
    return "[provider detail omitted]";
  }
  onlyDigits(value) {
    return this.trim(value).replace(/[^0-9]/g, "");
  }
  trim(value) {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value).trim();
    }
    return "";
  }
}
