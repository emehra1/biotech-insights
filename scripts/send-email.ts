import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import nodemailer from "nodemailer";

import { renderDigestEmail } from "../lib/email/render";
import { isoDay } from "../pipeline/normalize/dates";
import { isoWeek } from "../pipeline/normalize/dates";
import { readDigest, readWeekly, writeDigest } from "../pipeline/state/store";

/**
 * Renders and (optionally) sends the daily digest email.
 *
 * Preview is the default: the old script hard-failed at import when any SMTP
 * variable was missing, which made `npm run email` unusable for anyone who just
 * wanted to see the output. Sending requires an explicit --send.
 *
 *   npm run email                      # preview to .preview/<date>.html
 *   npm run email -- --send            # actually send
 *   npm run email -- --date 2026-08-03 --send --weekly
 */

interface Args {
  date?: string;
  send: boolean;
  force: boolean;
  weekly: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { send: false, force: false, weekly: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--send") args.send = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--weekly") args.weekly = true;
    else if (arg === "--date") args.date = argv[++i] || undefined;
    else if (arg.startsWith("--date=")) args.date = arg.slice(7);
  }
  return args;
}

const SMTP_VARS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM", "MAIL_TO"];

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date ?? isoDay(new Date(), process.env.TZ || "America/New_York");

  const digest = readDigest(date);
  if (!digest) {
    console.error(`No digest for ${date}. Run \`npm run pipeline\` first.`);
    return 1;
  }

  if (digest.emailedAt && args.send && !args.force) {
    console.log(`Digest ${date} was already emailed at ${digest.emailedAt}. Use --force to resend.`);
    return 0;
  }

  const weekly = args.weekly ? readWeekly(isoWeek(new Date(`${date}T12:00:00Z`))) : undefined;
  const siteUrl = process.env.SITE_URL;

  const email = renderDigestEmail(digest, { siteUrl, weekly });
  const sizeKb = (Buffer.byteLength(email.html) / 1024).toFixed(1);

  if (!args.send) {
    const file = path.join(".preview", `${date}.html`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, email.html, "utf8");
    console.log(`Preview written to ${file} (${sizeKb} KB)`);
    console.log(`Subject: ${email.subject}`);
    console.log("\n--- text part ---\n");
    console.log(email.text);
    console.log("\nAdd --send (with SMTP env set) to actually send.");
    return 0;
  }

  const missing = SMTP_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Cannot send: missing ${missing.join(", ")}`);
    return 1;
  }

  const port = Number(process.env.SMTP_PORT);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // Port 25 is blocked on GitHub's runners; use 465 (implicit TLS) or 587.
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 20_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });

  const send = () =>
    transport.sendMail({
      from: process.env.MAIL_FROM,
      to: process.env.MAIL_TO,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

  try {
    await send();
  } catch (error) {
    console.warn(`First send attempt failed (${String(error)}); retrying once…`);
    await send();
  }

  writeDigest({ ...digest, emailedAt: new Date().toISOString() });
  console.log(`Sent "${email.subject}" to ${process.env.MAIL_TO} (${sizeKb} KB)`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
