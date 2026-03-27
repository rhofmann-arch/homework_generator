FROM texlive/texlive:latest

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --break-system-packages

COPY backend/ .
COPY pacing_guides/ /pacing_guides/
COPY problem_bank/ /problem_bank/

CMD uvicorn main:app --host 0.0.0.0 --port $PORT
