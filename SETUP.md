# GitHub Setup — Step by Step

Follow these steps to get the repo live on GitHub with Pages configured.

---

## Step 1 — Create the GitHub Repository

1. Go to https://github.com/new
2. Repository name: `math-homework-generator`
3. Set to **Private** (recommended — keeps your pacing guides and API key config internal)
4. Leave "Initialize repository" unchecked (we'll push existing files)
5. Click **Create repository**

---

## Step 2 — Push This Repo to GitHub

Open a terminal in the `math-homework-generator/` folder:

```bash
git init
git add .
git commit -m "Initial project structure"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/math-homework-generator.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

---

## Step 3 — Add the Pacing Guide

Copy the Excel pacing guide into `pacing_guides/`:
```bash
cp /path/to/6th_Grade_Math_Pacing_Guide_20262027.xlsx pacing_guides/
git add pacing_guides/
git commit -m "Add 6th grade pacing guide"
git push
```

---

## Step 4 — Export and Add Honors Problems from Overleaf

For each assignment in your Overleaf project:
1. In Overleaf: Menu → Download → Source (.zip)
2. Extract the `.tex` files
3. Copy them to `problem_bank/honors/`, renaming to `ch{N}_{description}.tex`
4. Add the `% BEGIN / END CHALLENGE PROBLEMS` markers around the problem content
5. Commit and push:
```bash
git add problem_bank/honors/
git commit -m "Add honors challenge problems from Overleaf"
git push
```

---

## Step 5 — Configure GitHub Pages

1. In your repo: **Settings → Pages**
2. Under "Source": select **GitHub Actions**
3. The `deploy-frontend.yml` workflow will handle builds automatically

---

## Step 6 — Add the API URL Secret

(Do this after deploying the backend to Render in Step 7)

1. **Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Name: `VITE_API_URL`
4. Value: your Render backend URL (e.g. `https://math-homework-backend.onrender.com`)

---

## Step 7 — Deploy Backend to Render

1. Go to https://render.com and sign up / log in
2. **New → Web Service**
3. Connect your GitHub account and select `math-homework-generator`
4. Settings:
   - **Root directory:** `backend`
   - **Build command:** `pip install -r requirements.txt && apt-get install -y texlive-full`
   - **Start command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Plan:** Free
5. Under **Environment Variables**, add:
   - `ANTHROPIC_API_KEY` → your Anthropic API key
6. Click **Deploy**

> **Note:** The first deploy takes ~10 minutes because `texlive-full` is large (~4GB).
> Subsequent deploys are much faster.

---

## Step 8 — Initialize the Frontend

```bash
cd frontend
npm create vite@latest . -- --template react-ts
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

Then re-push:
```bash
cd ..
git add frontend/
git commit -m "Initialize React frontend"
git push
```

The GitHub Actions workflow will build and deploy to Pages automatically.

---

## You're Live!

Your app will be at:  
`https://YOUR_USERNAME.github.io/math-homework-generator/`

The backend API is at:  
`https://math-homework-backend.onrender.com`

---

## Adding Other Teachers

Since the repo is private, you have two options:
- **Collaborators** (GitHub Settings → Collaborators): they can pull/push the repo
- **No GitHub access needed**: just share the GitHub Pages URL — teachers only need the web app, not the repo

---

## Updating the Pacing Guide Mid-Year

Just replace the Excel file and push:
```bash
cp /new/path/6th_Grade_Math_Pacing_Guide_20262027.xlsx pacing_guides/
git add pacing_guides/
git commit -m "Update pacing guide"
git push
```

The backend reads the file at request time, so the update is live immediately.
