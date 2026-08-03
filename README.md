# Biotech Insights

A Next.js website and automation scaffold for collecting biotech news, academic papers, translational updates, and daily summary emails.

## Features

- Biotech news aggregation from sources like Endpoints News and Fierce Biotech
- Academic paper feeds for Nature, Science, JAMA, Cell, NEJM, bioRxiv, medRxiv
- Categories for aging, epigenetics, 3D genome / single-cell omics, translation, and platform R&D
- Email automation script for daily summaries
- Aesthetic and clear dashboard layout ready for customization

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env
```

3. Fill in SMTP settings in `.env`.

## Development

```bash
npm run dev
```

## Generate summary JSON

```bash
npm run generate
```

## Send daily summary email

```bash
npm run email
```

## Next steps

- Add provider credentials for premium feeds or APIs if needed
- Improve scrape rules and source coverage for clinical outcomes, deals, and platform R&D
- Add NLP summarization or OpenAI integration for richer abstracts and context
