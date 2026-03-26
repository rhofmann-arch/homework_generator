# Math Homework Generator

A web app for generating print-ready math homework PDFs for grades 5–8.  
Each assignment is a single double-sided sheet: spiral review on the front, lesson-aligned practice on the back.

## Project Structure

```
math-homework-generator/
├── frontend/               # React app → deployed to GitHub Pages
├── backend/                # FastAPI app → deployed to Render.com
│   ├── routes/             # API endpoints
│   ├── services/           # Claude API, LaTeX compilation, pacing guide parsing
│   └── templates/          # LaTeX .tex templates
├── problem_bank/
│   ├── honors/             # Challenge problem .tex snippets (exported from Overleaf)
│   └── spiral_review/      # Style reference problems by topic
├── pacing_guides/          # Excel pacing guides (updatable by teachers)
└── scripts/                # Local dev utilities
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Tailwind CSS → GitHub Pages |
| Backend | Python + FastAPI → Render.com (free tier) |
| PDF generation | LaTeX (pdflatex) compiled server-side |
| AI | Anthropic Claude API (problem generation) |
| Math rendering | amsmath, tikz, asymptote (same packages as honors assignments) |

## Setup

### Prerequisites
- Node.js 18+
- Python 3.11+
- A LaTeX distribution (TeX Live recommended): `sudo apt install texlive-full`
- An Anthropic API key

### Local Development

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add your ANTHROPIC_API_KEY
uvicorn main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

### Deployment

- **Backend:** Connect the GitHub repo to [Render.com](https://render.com). Set root directory to `backend/`. Add `ANTHROPIC_API_KEY` as an environment variable.
- **Frontend:** GitHub Actions automatically builds and deploys to GitHub Pages on push to `main`. Set `VITE_API_URL` to your Render backend URL in the Actions secret.

## Adding / Updating Content

- **Pacing guides:** Replace or update the `.xlsx` files in `pacing_guides/`. The backend reads these directly.
- **Honors challenge problems:** Export `.tex` files from Overleaf and place in `problem_bank/honors/`, named `ch{N}_{description}.tex` (e.g., `ch2_ratio_challenge.tex`).
- **Spiral review style references:** Add `.tex` snippets to `problem_bank/spiral_review/` organized by topic.

## Class Types

| Type | HW time target | Back page | Challenge problems |
|---|---|---|---|
| Grade-level | 20 min | Full page extra practice | No |
| Honors | 30 min | ~¾ page extra practice | 1–2 at bottom |

## Grades Supported

- ✅ Grade 6 (initial build)
- 🔜 Grade 5
- 🔜 Grades 7–8 (separate template; more complex rendering needs)
