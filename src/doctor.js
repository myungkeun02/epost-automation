import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { chromium } from "playwright-core";
import { checkWritableParent } from "./cli-files.js";
import { validateCredentials } from "./validation.js";
export function credentialsFromEnv(env = process.env) {
  return {
    username: env.EPOST_USERNAME,
    password: env.EPOST_PASSWORD,
    card: {
      number: env.EPOST_CARD_NUMBER,
      expiry: env.EPOST_CARD_EXPIRY,
      passwordPrefix: env.EPOST_CARD_PASSWORD_PREFIX,
      identity: env.EPOST_CARD_IDENTITY,
    },
  };
}
export async function diagnose({
  env = process.env,
  journalPath = ".epost/operations.sqlite",
  payment = false,
} = {}) {
  const checks = [];
  const check = (name, ok, hint) =>
    checks.push({
      name,
      status: ok ? "ok" : "missing",
      ...(ok ? {} : { hint }),
    });
  const [major, minor] = process.versions.node.split(".").map(Number);
  check(
    "node",
    major > 22 || (major === 22 && minor >= 14),
    "Node.js 22.14 이상을 설치하세요.",
  );
  let browserOK = false;
  try {
    await access(
      env.EPOST_BROWSER_PATH || chromium.executablePath(),
      constants.X_OK,
    );
    browserOK = true;
  } catch {}
  check(
    "browser",
    browserOK,
    "npm run browser:install 또는 EPOST_BROWSER_PATH 설정이 필요합니다.",
  );
  const credentials = credentialsFromEnv(env);
  let loginOK = false,
    paymentOK = false;
  try {
    validateCredentials(credentials);
    loginOK = true;
  } catch {}
  check(
    "login-fields",
    loginOK,
    "EPOST_USERNAME과 EPOST_PASSWORD를 설정하세요. 실제 로그인 성공 여부는 확인하지 않습니다.",
  );
  if (payment) {
    try {
      validateCredentials(credentials, true);
      paymentOK = true;
    } catch {}
    check(
      "payment-fields",
      paymentOK,
      "카드번호 16자리, MMYY, 비밀번호 앞 2자리, 생년월일 6자리/사업자번호 10자리를 문자열로 설정하세요.",
    );
  }
  check(
    "journal-directory",
    await checkWritableParent(journalPath),
    "작업 기록을 저장할 상위 폴더의 쓰기 권한을 확인하세요.",
  );
  return {
    ok: checks.every((check) => check.status === "ok"),
    networkUsed: false,
    checks,
    message:
      "로컬 설치와 설정 형식만 확인했습니다. 사이트 로그인·카드 승인·방문 가능일은 확인하지 않았습니다.",
  };
}
