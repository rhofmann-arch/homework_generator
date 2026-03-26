#!/usr/bin/env bash
# Render.com build script for the backend.
# Installs Python dependencies and a minimal TeX Live distribution
# (texlive-latex-extra covers amsmath, geometry, fancyhdr, tikz, mdframed, etc.)

set -e

echo "==> Installing Python dependencies"
pip install -r backend/requirements.txt

echo "==> Installing TeX Live (minimal + required packages)"
apt-get update -qq
apt-get install -y --no-install-recommends \
  texlive-latex-base \
  texlive-latex-extra \
  texlive-fonts-recommended \
  texlive-science \
  texlive-pictures \
  lmodern

echo "==> Build complete"
