import nodemailer from "nodemailer";
import { getSummary } from "@/lib/summary";
import dotenv from "dotenv";

dotenv.config();

const {
  EMAIL_HOST,
  EMAIL_PORT,
  EMAIL_USER,
  EMAIL_PASSWORD,
  EMAIL_FROM,
  EMAIL_TO,
  MAIL_SUBJECT = "Daily Biotech Insights Summary"
} = process.env;

if (!EMAIL_HOST || !EMAIL_PORT || !EMAIL_USER || !EMAIL_PASSWORD || !EMAIL_FROM || !EMAIL_TO) {
  throw new Error("Please set EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD, EMAIL_FROM, and EMAIL_TO in .env");
}

function renderHtml(summary: Awaited<ReturnType<typeof getSummary>>): string {
  return `
    <html>
      <body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; background: #f8fafc; padding: 24px;">
        <h1 style="margin-bottom: 0.25rem;">Daily Biotech Insights</h1>
        <p style="margin-top: 0; color: #475569;">A daily digest of biotech news, translational papers, platform R&D, and aging biology.</p>
        ${summary.categories
          .map(
            (category) => `
              <section style="margin-top: 24px;">
                <h2 style="margin-bottom: 8px; font-size: 18px;">${category.name}</h2>
                <p style="margin: 0 0 16px 0; color: #64748b;">${category.description}</p>
                <ul style="padding-left: 18px; margin: 0;">
                  ${category.items
                    .map(
                      (item) => `
                        <li style="margin-bottom: 12px;">
                          <strong><a href="${item.url}" style="color: #0f172a;">${item.title}</a></strong><br />
                          <span style="color: #475569;">${item.source} ${item.publishedAt ? `• ${new Date(item.publishedAt).toLocaleDateString()}` : ""}</span><br />
                          <span style="color: #334155;">${item.summary}</span>
                        </li>`
                    )
                    .join("")}
                </ul>
              </section>`
          )
          .join("")}
      </body>
    </html>
  `;
}

async function main() {
  const summary = await getSummary();
  const transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: Number(EMAIL_PORT),
    secure: Number(EMAIL_PORT) === 465,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASSWORD
    }
  });

  const html = renderHtml(summary);

  const info = await transporter.sendMail({
    from: EMAIL_FROM,
    to: EMAIL_TO,
    subject: MAIL_SUBJECT,
    html
  });

  console.log(`Email sent: ${info.messageId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
