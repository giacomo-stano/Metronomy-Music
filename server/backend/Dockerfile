FROM golang:1.26 AS qoget
ARG QOGET_COMMIT=fea61a3f97b4008d36e52d4f1b362a89e51465a2
RUN git clone https://github.com/davidetoniatti/qoget.git /src \
    && cd /src \
    && git checkout "$QOGET_COMMIT"
WORKDIR /src
COPY qoget-appid ./cmd/metronomy-appid
RUN CGO_ENABLED=0 go build -o /out/qoget ./cmd/qoget \
    && CGO_ENABLED=0 go build -o /out/metronomy-appid ./cmd/metronomy-appid \
    && cp LICENSE /out/QOGET_LICENSE

FROM python:3.12-slim
COPY --from=qoget /out/qoget /usr/local/bin/qoget
COPY --from=qoget /out/metronomy-appid /usr/local/bin/metronomy-appid
COPY --from=qoget /out/QOGET_LICENSE /usr/share/licenses/qoget/LICENSE
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
