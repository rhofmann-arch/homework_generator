#!/usr/bin/env python3
"""Compile test PDFs. Run from repo root: python scripts/test_pdf.py"""

import subprocess, sys, os, shutil, tempfile, argparse
from pathlib import Path

TEMPLATE = Path("backend/templates/homework.tex").read_text()

FRONT_LEFT = r"""\frontproblem{Write $6 \times 6 \times 6$ as a power.}
\frontproblem{Evaluate $4^3$.}
\frontproblem{Is 48 a perfect square? Explain.}
\frontproblem{List all factors of 36.}
\stepcounter{prob}\noindent\textbf{\normalsize\theprob.}\enspace{\normalsize Simplify: $5 + 2 \times 4 - 1$}"""

FRONT_RIGHT = r"""\frontproblem{Find the GCF of 24 and 36.}
\frontproblem{Write $\dfrac{3}{4} + \dfrac{1}{6}$ and simplify.}
\frontproblem{Is 37 prime or composite? Explain.}
\frontproblem{Evaluate: $3^2 + 2^3$}
\stepcounter{prob}\noindent\textbf{\normalsize\theprob.}\enspace{\normalsize
Plot the point $(3, -2)$ on the coordinate plane.
\begin{center}\begin{tikzpicture}[scale=0.42]
  \draw[gray!35,step=1](-3.5,-3.5)grid(3.5,3.5);
  \draw[->](-3.7,0)--(3.7,0)node[right]{\tiny$x$};
  \draw[->](0,-3.7)--(0,3.7)node[above]{\tiny$y$};
  \foreach \x in{-3,-2,-1,1,2,3}{
    \draw(\x,.07)--(\x,-.07)node[below]{\tiny\x};
    \draw(.07,\x)--(-.07,\x)node[left]{\tiny\x};}
\end{tikzpicture}\end{center}}"""

BACK_HONORS = r"""\backproblem{Write the ratio of 8 boys to 12 girls in three ways.}
\backproblem{A car travels 150 miles in 3 hours. Write the unit rate.}
\backproblem{Are $\dfrac{3}{4}$ and $\dfrac{9}{12}$ equivalent ratios? Show your work.}
\backproblem{A recipe uses 2 cups of flour for every 3 cups of sugar. How much flour for 9 cups of sugar?}
\backproblem{Write the ratio $15:45$ in simplest form.}
\backproblem{A store sells 5 notebooks for \$6.25. What is the unit price?}"""

BACK_GL = r"""\backproblem{Write the ratio of 6 to 10 in simplest form.}
\backproblem{A car goes 120 miles in 2 hours. Find the unit rate.}
\backproblem{Are $\dfrac{2}{3}$ and $\dfrac{6}{9}$ equivalent?}
\backproblem{3 eggs per 2 cups of milk — how many eggs for 8 cups?}
\backproblem{Write the ratio $20:35$ in simplest form.}
\backproblem{4 pencils cost \$1.20. Find the unit price.}
\backproblem{Write three equivalent ratios to $\dfrac{2}{5}$.}
\stepcounter{prob}\noindent\textbf{\normalsize\theprob.}\enspace{\normalsize A class has 14 boys and 16 girls. Write the ratio of boys to total.}"""

CHALLENGE = r"""\challengeblock{
\stepcounter{prob}\noindent\textbf{\normalsize\theprob.}\enspace\normalsize
Amanda, Ben, and Carlos share money in ratio $1:2:7$. Amanda's share is \$20.
What is the total amount shared?
\par\vspace{1.0in}
\stepcounter{prob}\noindent\textbf{\normalsize\theprob.}\enspace\normalsize
The ratio of youths to adults at a skating rink is $13:7$.
What percent of the people are youths?
\par\vspace{1.0in}
}"""

def compile_pdf(filled, dest):
    tmpdir = tempfile.mkdtemp(prefix="hw_test_")
    tex    = os.path.join(tmpdir, "homework.tex")
    pdf    = os.path.join(tmpdir, "homework.pdf")
    with open(tex, "w") as f: f.write(filled)
    for _ in range(2):
        r = subprocess.run(
            ["pdflatex", "-interaction=nonstopmode", "-output-directory", tmpdir, tex],
            capture_output=True, text=True)
    if os.path.exists(pdf):
        shutil.copy(pdf, dest)
        print(f"✅  {dest}")
    else:
        print(f"❌  Compilation failed:")
        for line in r.stdout.splitlines():
            if line.startswith("!") or line.startswith("l."): print("   ", line)
        sys.exit(1)

parser = argparse.ArgumentParser()
parser.add_argument("--type", choices=["honors","grade_level","both"], default="both")
args = parser.parse_args()

BASE = dict(
    COURSE_NAME="Honors Math 6", HW_NUMBER="7", DATE="Week of Sep 22, 2026",
    FRONT_COL_LEFT=FRONT_LEFT, FRONT_COL_RIGHT=FRONT_RIGHT,
    LESSON_NUMBERS="2.3--2.4", LESSON_TITLE="Ratios and Rates",
)

if args.type in ("honors","both"):
    filled = TEMPLATE
    for k,v in {**BASE,
        "COURSE_NAME": "Honors Math 6",
        "BACK_COL_HT": r"\dimexpr\bodycolht-3.10in\relax",
        "BACK_PROBLEMS": BACK_HONORS,
        "CHALLENGE_BLOCK": CHALLENGE,
    }.items():
        filled = filled.replace(f"<<{k}>>", v)
    compile_pdf(filled, "/tmp/hw_honors.pdf")

if args.type in ("grade_level","both"):
    filled = TEMPLATE
    for k,v in {**BASE,
        "COURSE_NAME": "6th Grade Math",
        "BACK_COL_HT": r"\bodycolht",
        "BACK_PROBLEMS": BACK_GL,
        "CHALLENGE_BLOCK": "",
    }.items():
        filled = filled.replace(f"<<{k}>>", v)
    compile_pdf(filled, "/tmp/hw_grade_level.pdf")
