#!/bin/bash
# ============================================================
# Mini SCADA — VPS Setup  (Ubuntu 22.04)
# Run: sudo bash ~/setup_vps.sh
# ============================================================
set -e

RABBIT_USER="scada"
RABBIT_PASS="7daa459bb7920d755d40bd85e3a9a11e"
SCADA_DIR="/opt/mini_scada"
SCADA_USER="scada"

echo "======================================================="
echo " Mini SCADA — VPS Setup"
echo "======================================================="

# ── 1. RabbitMQ ───────────────────────────────────────────
echo ""
echo "[1/5] Installing RabbitMQ..."
apt-get update -qq
apt-get install -y rabbitmq-server
systemctl enable rabbitmq-server
systemctl start  rabbitmq-server
echo "  OK"

# ── 2. RabbitMQ user ─────────────────────────────────────
echo ""
echo "[2/5] Configuring RabbitMQ user..."
rabbitmqctl delete_user guest 2>/dev/null || true

if rabbitmqctl list_users | grep -q "^${RABBIT_USER}"; then
    rabbitmqctl change_password "${RABBIT_USER}" "${RABBIT_PASS}"
    echo "  -> Password updated for '${RABBIT_USER}'"
else
    rabbitmqctl add_user "${RABBIT_USER}" "${RABBIT_PASS}"
    echo "  -> User '${RABBIT_USER}' created"
fi

rabbitmqctl set_user_tags    "${RABBIT_USER}" administrator
rabbitmqctl set_permissions -p / "${RABBIT_USER}" ".*" ".*" ".*"
echo "  OK"

# ── 3. Management plugin ─────────────────────────────────
echo ""
echo "[3/5] Enabling management plugin..."
rabbitmq-plugins enable rabbitmq_management
echo "  OK (access via SSH tunnel: ssh -L 15672:localhost:15672 nikolay@vlahovski.info)"

# ── 4. Firewall ──────────────────────────────────────────
echo ""
echo "[4/5] Firewall..."
ufw allow 5672/tcp comment "RabbitMQ AMQP" || true
ufw --force enable || true
echo "  OK — port 5672 open"

# ── 5. Orchestrator service ──────────────────────────────
echo ""
echo "[5/5] Setting up orchestrator..."

# System user
id -u "${SCADA_USER}" &>/dev/null || useradd -r -s /bin/false "${SCADA_USER}"

# Code directory
mkdir -p "${SCADA_DIR}/tasks_inbox"
mkdir -p "${SCADA_DIR}/logs"
cp -r /home/nikolay/mini_scada_orchestrator "${SCADA_DIR}/orchestrator"
cp /home/nikolay/scada.env "${SCADA_DIR}/.env"
chown -R "${SCADA_USER}:${SCADA_USER}" "${SCADA_DIR}"

# Python venv
apt-get install -y python3 python3-venv -qq
python3 -m venv "${SCADA_DIR}/venv"
"${SCADA_DIR}/venv/bin/pip" install -q pika

# systemd service
cat > /etc/systemd/system/scada-orchestrator.service << EOF
[Unit]
Description=Mini SCADA Orchestrator
After=network.target rabbitmq-server.service
Requires=rabbitmq-server.service

[Service]
Type=simple
User=${SCADA_USER}
WorkingDirectory=${SCADA_DIR}
EnvironmentFile=${SCADA_DIR}/.env
ExecStart=${SCADA_DIR}/venv/bin/python -m orchestrator.orchestrator
Restart=on-failure
RestartSec=10
StandardOutput=append:${SCADA_DIR}/logs/orchestrator.log
StandardError=append:${SCADA_DIR}/logs/orchestrator.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable scada-orchestrator
systemctl start  scada-orchestrator
echo "  OK"

echo ""
echo "======================================================="
echo " Setup complete!"
echo ""
echo " RabbitMQ : amqp://${RABBIT_USER}:${RABBIT_PASS}@vlahovski.info:5672/"
echo ""
echo " Orchestrator status:"
systemctl status scada-orchestrator --no-pager -l
echo "======================================================="
