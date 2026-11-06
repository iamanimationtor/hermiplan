/**
 * Password credentials — rules and hashing, with no server and no database.
 *
 *   npx tsx scripts/password-check.ts
 *
 * What this suite refuses to let slide:
 *  • storing anything that can be replayed (`hashPassword` must be salted and
 *    one-way; two identical passwords must not produce identical rows);
 *  • a malformed digest opening an account instead of closing it;
 *  • username rules that quietly differ between "what we store" and "what we
 *    compare against", which is how duplicate accounts appear later.
 */
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  RESERVED_USERNAMES,
  SCRYPT,
  USERNAME_MAX,
  USERNAME_MIN,
  canonicalUsername,
  hashPassword,
  isReservedUsername,
  normalizeUsername,
  passwordProblem,
  usernameProblem,
  verifyPassword,
} from "../src/lib/server/password";

let passed = 0;
const failures: string[] = [];
function check(condition: boolean, message: string, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${message}`);
  } else {
    failures.push(message);
    console.log(`  ✗ ${message}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  console.log("▶ ۱. هش رمز: نمک، یک‌طرفه بودن و پارامترهای همراهِ هش");
  const digest = await hashPassword("CorrectHorse1");
  const parts = digest.split("$");
  check(parts.length === 6 && parts[0] === "scrypt", "قالب scrypt$N$r$p$salt$hash است", digest.slice(0, 24));
  check(
    Number(parts[1]) === SCRYPT.N && Number(parts[2]) === SCRYPT.r && Number(parts[3]) === SCRYPT.p,
    "پارامترهای هزینه همراه هش ذخیره می‌شوند",
    parts.slice(1, 4).join("/"),
  );
  check(!digest.includes("CorrectHorse1"), "رمز خام در هش نیست");
  check(parts[4].length >= 16 && parts[5].length >= 32, "نمک و هش هر دو غیرخالی و به‌اندازه کافی بلندند");

  const second = await hashPassword("CorrectHorse1");
  check(second !== digest, "یک رمز، دو هش متفاوت (نمک تصادفی)");
  check(await verifyPassword("CorrectHorse1", digest), "رمز درست پذیرفته می‌شود");
  check(await verifyPassword("CorrectHorse1", second), "هر دو هش همان رمز را می‌پذیرند");
  check(!(await verifyPassword("CorrectHorse2", digest)), "رمز غلط رد می‌شود");
  check(!(await verifyPassword("correcthorse1", digest)), "حساس به بزرگی/کوچکی حرف است");

  console.log("\n▶ ۲. هش خراب یا ناشناخته: بستن در، نه شکستن");
  for (const broken of [
    null,
    undefined,
    "",
    "plain-text-password",
    "scrypt$32768$8$1$onlyfive",
    "scrypt$notanumber$8$1$c2FsdA$aGFzaA",
    "scrypt$2$8$1$c2FsdA$aGFzaA",
    "scrypt$99999999$8$1$c2FsdA$aGFzaA",
    "bcrypt$10$abc",
    "scrypt$32768$8$1$$",
  ]) {
    let threw = false;
    let allowed = true;
    try {
      allowed = await verifyPassword("whatever", broken as string | null | undefined);
    } catch {
      threw = true;
    }
    check(!threw && !allowed, `هش نامعتبر ${JSON.stringify(broken)} ⇒ رد، بدون خطا`);
  }

  console.log("\n▶ ۳. رمز عبور با نویسه‌های غیرلاتین");
  const persian = "گذرواژه۱۲۳";
  const persianDigest = await hashPassword(persian);
  check(await verifyPassword(persian, persianDigest), "رمز فارسی/یونیکد درست تأیید می‌شود");
  check(!(await verifyPassword("گذرواژه123", persianDigest)), "ارقام فارسی با لاتین یکی گرفته نمی‌شوند");

  console.log("\n▶ ۴. سیاست رمز عبور");
  check(passwordProblem("abcd1234") === null, "۸ نویسه با حرف و رقم پذیرفته می‌شود");
  check(passwordProblem("a".repeat(PASSWORD_MIN - 1))!.includes("۸"), "کوتاه‌تر از ۸ نویسه رد می‌شود");
  check(passwordProblem("abcdefgh") !== null, "بدون رقم رد می‌شود");
  check(passwordProblem("12345678") !== null, "بدون حرف رد می‌شود");
  check(passwordProblem("") !== null, "خالی رد می‌شود");
  check(passwordProblem("a1".repeat(PASSWORD_MAX)) !== null, "بلندتر از سقف رد می‌شود");
  check(passwordProblem("a1" + "x".repeat(PASSWORD_MAX - 2)) === null, "دقیقاً در سقف پذیرفته می‌شود");
  check(passwordProblem(12345678 as unknown) !== null, "مقدار غیرمتنی رد می‌شود");

  console.log("\n▶ ۵. نام کاربری: یک قاعده، هم برای ذخیره هم برای مقایسه");
  check(usernameProblem("ali") === null, "نام ساده پذیرفته می‌شود");
  check(usernameProblem("ali.rezaei_1400") === null, "نقطه و زیرخط و رقم مجاز است");
  check(usernameProblem("  Ali  ") === null, "فاصلهٔ اضافه پذیرفته و اصلاح می‌شود");
  check(canonicalUsername("  ALI.Rezaei  ") === "ali.rezaei", "نام به کوچک و بدون فاصله نرمال می‌شود");
  check(usernameProblem("ab") !== null, `کوتاه‌تر از ${USERNAME_MIN} نویسه رد می‌شود`);
  check(usernameProblem("a".repeat(USERNAME_MAX + 1)) !== null, `بلندتر از ${USERNAME_MAX} نویسه رد می‌شود`);
  check(usernameProblem("ali rezaei") !== null, "فاصلهٔ داخلی رد می‌شود");
  check(usernameProblem("ali!") !== null, "نویسهٔ غیرمجاز رد می‌شود");
  check(usernameProblem("-ali") !== null, "شروع با خط تیره رد می‌شود");
  check(usernameProblem("ali.") !== null, "پایان با نقطه رد می‌شود");
  check(usernameProblem("علی") !== null, "حروف فارسی در نام کاربری مجاز نیست");
  check(usernameProblem("") !== null, "نام خالی رد می‌شود");
  check(canonicalUsername("user۱۲۳") === "user123", "ارقام فارسی به لاتین تبدیل می‌شوند");
  check(normalizeUsername("ali\u200crezaei") === "alirezaei", "نویسهٔ نیم‌فاصله حذف می‌شود");
  check(isReservedUsername("admin") && RESERVED_USERNAMES.has("support"), "نام‌های رزرو‌شده شناخته می‌شوند");
  check(!isReservedUsername("ali"), "نام معمولی رزرو نشده است");

  console.log(
    failures.length === 0
      ? `\n✔ ${passed} بررسی رمز عبور/نام کاربری — همه موفق`
      : `\n✘ ${passed} موفق / ${failures.length} ناموفق`,
  );
  if (failures.length) {
    for (const failure of failures) console.log(`   - ${failure}`);
    process.exit(1);
  }
}

void main();
