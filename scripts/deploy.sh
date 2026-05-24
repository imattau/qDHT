#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="qdht"
SERVICE_NAME="qdht"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="/opt/qdht"
CONFIG_DIR="/etc/qdht"
CONFIG_FILE="${CONFIG_DIR}/config.json"
DATA_DIR="/var/lib/qdht"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
CADDY_MAIN_FILE="/etc/caddy/Caddyfile"
CADDY_CADDYFILE_D="/etc/caddy/Caddyfile.d"
CADDY_CONF_D="/etc/caddy/conf.d"
NGINX_SITE_DIR="/etc/nginx/sites-available"
NGINX_ENABLED_DIR="/etc/nginx/sites-enabled"
NGINX_SITE_FILE="${NGINX_SITE_DIR}/${SERVICE_NAME}.conf"
NGINX_ENABLED_FILE="${NGINX_ENABLED_DIR}/${SERVICE_NAME}.conf"

DEFAULT_PORT="8080"
DEFAULT_QUIC_PORT="8443"
DEFAULT_WEB_PORT=""
DEFAULT_PEERS="[]"
DEFAULT_RELAYS="[]"
MANAGED_MARKER="# managed by qdht"

ACTION="install"
PROXY_MODE="${QDHT_PROXY:-auto}"
DOMAIN="${QDHT_DOMAIN:-}"
PORT_OVERRIDE="${QDHT_PORT:-}"
QUIC_PORT_OVERRIDE="${QDHT_QUIC_PORT:-}"
WEB_PORT_OVERRIDE="${QDHT_WEB_PORT:-}"
NON_INTERACTIVE=false
DRY_RUN="${QDHT_DRY_RUN:-false}"
NODE_BIN="${NODE_BIN:-}"
NPM_BIN="${NPM_BIN:-}"
TEMP_DIRS=()
declare -A BACKUPS=()
declare -a CREATED_FILES=()
IN_ROLLBACK=false
CURRENT_ACTION=""

log() {
	printf '[deploy] %s\n' "$*"
}

warn() {
	printf '[deploy] warning: %s\n' "$*" >&2
}

die() {
	printf '[deploy] error: %s\n' "$*" >&2
	exit 1
}

on_error() {
	local line="$1"
	local cmd="$2"
	printf '[deploy] error: command failed at line %s: %s\n' "$line" "$cmd" >&2
	if [[ "$IN_ROLLBACK" == false && "$CURRENT_ACTION" =~ ^(install|update)$ ]]; then
		rollback
	fi
	exit 1
}

trap 'on_error "$LINENO" "$BASH_COMMAND"' ERR
trap 'cleanup' EXIT

cleanup() {
	local dir
	for dir in "${TEMP_DIRS[@]}"; do
		if [[ -n "$dir" && -d "$dir" ]]; then
			rm -rf "$dir"
		fi
	done
}

is_true() {
	case "${1,,}" in
		1|true|yes|on) return 0 ;;
		*) return 1 ;;
	esac
}

log_plan() {
	log "[dry-run] $*"
}

rollback() {
	if [[ "$IN_ROLLBACK" == true ]]; then
		return
	fi
	if [[ -z "${SUDO:-}" && "${EUID}" -ne 0 ]]; then
		return
	fi
	IN_ROLLBACK=true
	trap - ERR
	log "rolling back partial deployment"

	run_root systemctl stop "$SERVICE_NAME" 2>/dev/null || true
	run_root systemctl reset-failed "$SERVICE_NAME" 2>/dev/null || true

	local target backup
	for target in "${!BACKUPS[@]}"; do
		backup="${BACKUPS[$target]}"
		if [[ -f "$backup" ]]; then
			local restore_target
			restore_target="${target}.restore.$$"
			if [[ -n "${SUDO:-}" ]]; then
				"$SUDO" cp -a "$backup" "$restore_target"
				"$SUDO" mv -f "$restore_target" "$target"
			else
				cp -a "$backup" "$restore_target"
				mv -f "$restore_target" "$target"
			fi
		fi
	done

	for target in "${CREATED_FILES[@]}"; do
		if [[ -e "$target" ]]; then
			run_root rm -f "$target"
		fi
	done

	run_root systemctl daemon-reload 2>/dev/null || true
	run_root systemctl restart "$SERVICE_NAME" 2>/dev/null || true
	IN_ROLLBACK=false
}

usage() {
	cat <<'EOF'
Usage:
  scripts/deploy.sh install [--domain example.com] [--proxy auto|caddy|nginx|none] [--port 8080] [--quic-port 8443] [--web-port 3000] [--non-interactive] [--dry-run]
  scripts/deploy.sh update
  scripts/deploy.sh test

Environment overrides:
  QDHT_PROXY=auto|caddy|nginx|none
  QDHT_DOMAIN=example.com
  QDHT_PORT=8080
  QDHT_QUIC_PORT=8443
  QDHT_WEB_PORT=3000
  QDHT_DRY_RUN=true
  NODE_BIN=/path/to/node
  NPM_BIN=/path/to/npm

Defaults:
  install dir: /opt/qdht
  config:      /etc/qdht/config.json
  data:        /var/lib/qdht
  service:     /etc/systemd/system/qdht.service
EOF
}

print_install_plan() {
	log_plan "would install Node.js app from ${REPO_ROOT} to ${INSTALL_DIR}"
	log_plan "would write config to ${CONFIG_FILE}"
	log_plan "would write systemd service to ${SERVICE_FILE}"
	if [[ "$PROXY_MODE" == "none" ]]; then
		log_plan "would skip reverse proxy setup"
	else
		log_plan "would configure ${PROXY_MODE} for domain ${DOMAIN}"
	fi
	log_plan "would restart ${SERVICE_NAME} and smoke-test the node"
}

print_update_plan() {
	log_plan "would fetch and pull the latest source in ${REPO_ROOT}"
	log_plan "would reinstall npm dependencies and rsync app to ${INSTALL_DIR}"
	log_plan "would restart ${SERVICE_NAME} and smoke-test the node"
}

print_test_plan() {
	log_plan "would verify ${SERVICE_NAME} is active"
	log_plan "would probe the node HTTP endpoint"
	if [[ "$PROXY_MODE" != "none" && -n "$DOMAIN" ]]; then
		log_plan "would also probe the reverse proxy for ${DOMAIN}"
	fi
}

# ── Tool detection ────────────────────────────────────────────────────────────

detect_node_binary() {
	if [[ -n "$NODE_BIN" && -x "$NODE_BIN" ]]; then
		return
	fi
	if command -v node >/dev/null 2>&1; then
		NODE_BIN="$(command -v node)"
		return
	fi
	die "node is required"
}

detect_npm_binary() {
	if [[ -n "$NPM_BIN" && -x "$NPM_BIN" ]]; then
		return
	fi
	if command -v npm >/dev/null 2>&1; then
		NPM_BIN="$(command -v npm)"
		return
	fi
	die "npm is required"
}

check_node_version() {
	local have need
	need="20"
	have="$("$NODE_BIN" --version | sed 's/^v//' | cut -d. -f1)"
	if (( have < need )); then
		die "Node.js ${need} or newer required; found v${have}"
	fi
}

require_root_tools() {
	command -v git >/dev/null 2>&1 || die "git is required"
	command -v curl >/dev/null 2>&1 || die "curl is required"
	command -v rsync >/dev/null 2>&1 || die "rsync is required"
	command -v systemctl >/dev/null 2>&1 || die "systemctl is required"
	command -v install >/dev/null 2>&1 || die "install is required"
	command -v ss >/dev/null 2>&1 || warn "ss is not installed; port conflict diagnostics will be limited"
	detect_node_binary
	detect_npm_binary
}

ensure_sudo() {
	if [[ "${EUID}" -ne 0 ]]; then
		command -v sudo >/dev/null 2>&1 || die "sudo is required when not running as root"
		sudo -v
		SUDO="sudo"
	else
		SUDO=""
	fi
}

run_root() {
	if [[ -n "${SUDO:-}" ]]; then
		"${SUDO}" "$@"
	else
		"$@"
	fi
}

# ── Source management ─────────────────────────────────────────────────────────

repo_branch() {
	local branch
	branch="$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || true)"
	if [[ -z "$branch" ]]; then
		branch="main"
	fi
	printf '%s' "$branch"
}

update_source() {
	log "updating source checkout in ${REPO_ROOT}"
	local status
	status="$(git -C "$REPO_ROOT" status --porcelain)"
	if [[ -n "$status" ]]; then
		die "repository has local changes; commit or stash them before updating"
	fi
	git -C "$REPO_ROOT" fetch --tags origin
	git -C "$REPO_ROOT" pull --ff-only origin "$(repo_branch)"
}

# ── Build and install ─────────────────────────────────────────────────────────

build_app() {
	log "installing npm dependencies"
	(
		cd "$REPO_ROOT"
		"$NPM_BIN" ci --prefer-offline
	)

	log "compiling to dist/"
	(
		cd "$REPO_ROOT"
		"$NPM_BIN" run build:dist
	)
}

install_app() {
	log "syncing app to ${INSTALL_DIR}"
	run_root install -d -m 0755 "$INSTALL_DIR"
	run_root rsync -a --delete \
		--exclude='.git' \
		--exclude='.claude' \
		--exclude='docs' \
		--exclude='examples' \
		--exclude='*.md' \
		"${REPO_ROOT}/" "${INSTALL_DIR}/"
	run_root chown -R qdht:qdht "$INSTALL_DIR"
}

# ── Port utilities ────────────────────────────────────────────────────────────

listen_port_in_use() {
	local port="$1"
	if ! command -v ss >/dev/null 2>&1; then
		return 1
	fi
	ss -H -ltn "sport = :${port}" | grep -q .
}

pick_free_port() {
	local desired="$1"
	local avoid="${2:-}"
	local port="$desired"
	while listen_port_in_use "$port" || [[ -n "$avoid" && "$port" == "$avoid" ]]; do
		port=$((port + 1))
		if (( port > 65535 )); then
			die "no free ports available starting at ${desired}"
		fi
	done
	if [[ "$port" != "$desired" ]]; then
		warn "port ${desired} is busy; using ${port} instead"
	fi
	printf '%s' "$port"
}

check_port_free() {
	local port="$1"
	if ! command -v ss >/dev/null 2>&1; then
		return 0
	fi
	if ss -H -ltn "sport = :${port}" | grep -q .; then
		die "port ${port} is already in use; stop the other process or set QDHT_PORT to a free port"
	fi
}

# ── Config management ─────────────────────────────────────────────────────────

prompt() {
	local question="$1"
	local default="$2"
	local answer=""

	if [[ "$NON_INTERACTIVE" == true || ! -t 0 ]]; then
		answer="$default"
	else
		if [[ -r /dev/tty && -w /dev/tty ]]; then
			printf '%s [%s]: ' "$question" "$default" >/dev/tty
			exec 3</dev/tty
			IFS= read -r -u 3 answer || true
			exec 3<&-
		else
			read -r -p "${question} [${default}]: " answer
		fi
	fi

	printf '%s' "${answer:-$default}"
}

parse_config_field() {
	local field="$1"
	if [[ ! -f "$CONFIG_FILE" ]]; then
		printf ''
		return
	fi
	python3 -c "
import json, sys
try:
    cfg = json.load(open('$CONFIG_FILE'))
    val = cfg.get('$field', '')
    print(val if val is not None else '', end='')
except Exception:
    pass
" 2>/dev/null || true
}

write_config() {
	local port="$1"
	local quic_port="$2"
	local web_port="${3:-}"

	if [[ -f "$CONFIG_FILE" ]]; then
		log "rewriting config at ${CONFIG_FILE}"
		local backup_dir backup_file
		backup_dir="$(mktemp -d)"
		TEMP_DIRS+=("$backup_dir")
		backup_file="${backup_dir}/config.json.bak"
		run_root cp -a "$CONFIG_FILE" "$backup_file"
		BACKUPS["$CONFIG_FILE"]="$backup_file"

		# Preserve identity.privkey and peers from existing config
		local existing_privkey existing_peers
		existing_privkey="$(python3 -c "
import json
try:
    cfg = json.load(open('$CONFIG_FILE'))
    print(cfg.get('identity', {}).get('privkey', ''), end='')
except Exception:
    pass
" 2>/dev/null || true)"
		existing_peers="$(python3 -c "
import json
try:
    cfg = json.load(open('$CONFIG_FILE'))
    peers = cfg.get('peers', [])
    print(json.dumps(peers), end='')
except Exception:
    print('[]', end='')
" 2>/dev/null || true)"
	fi

	local tmp
	tmp="$(mktemp)"
	python3 - <<PYEOF >"$tmp"
import json

privkey = "${existing_privkey:-}"
peers = json.loads('${existing_peers:-[]}')
web_port_val = ${web_port:-0}

cfg = {
    "identity": {"privkey": privkey},
    "port": ${port},
    "quicListenPort": ${quic_port},
    "dataDir": "${DATA_DIR}",
    "peers": peers,
    "relays": [],
}
if web_port_val:
    cfg["webPort"] = web_port_val

print(json.dumps(cfg, indent=2))
PYEOF

	run_root install -d -m 0755 "$CONFIG_DIR"
	run_root install -m 0640 "$tmp" "$CONFIG_FILE"
	run_root chown root:qdht "$CONFIG_FILE"
	rm -f "$tmp"

	if [[ -z "${existing_privkey:-}" ]]; then
		log "config written; run 'qdht-node keygen' or add identity.privkey manually before starting"
	fi
}

# ── Proxy management ──────────────────────────────────────────────────────────

caddy_snippet_dir() {
	if [[ -n "${QDHT_CADDY_SNIPPET_DIR:-}" ]]; then
		printf '%s' "$QDHT_CADDY_SNIPPET_DIR"
		return
	fi
	if [[ -f "$CADDY_MAIN_FILE" ]]; then
		if grep -qE '^[[:space:]]*import[[:space:]].*(/etc/caddy/)?conf\.d/\*' "$CADDY_MAIN_FILE"; then
			printf '%s' "$CADDY_CONF_D"
			return
		fi
		if grep -qE '^[[:space:]]*import[[:space:]].*(/etc/caddy/)?Caddyfile\.d/\*' "$CADDY_MAIN_FILE"; then
			printf '%s' "$CADDY_CADDYFILE_D"
			return
		fi
	fi
	if [[ -d "$CADDY_CONF_D" ]]; then
		printf '%s' "$CADDY_CONF_D"
		return
	fi
	printf '%s' "$CADDY_CADDYFILE_D"
}

caddy_snippet_file() {
	local dir
	dir="$(caddy_snippet_dir)"
	printf '%s/%s.caddy' "$dir" "$SERVICE_NAME"
}

is_managed_file() {
	local file="$1"
	[[ -f "$file" ]] || return 1
	grep -qF "$MANAGED_MARKER" "$file"
}

write_managed_file() {
	local target="$1"
	local source="$2"
	if [[ -f "$target" ]] && ! is_managed_file "$target"; then
		die "${target} exists and is not managed by qdht; refusing to overwrite"
	fi

	if [[ -f "$target" ]]; then
		local backup_dir backup_file
		backup_dir="$(mktemp -d)"
		TEMP_DIRS+=("$backup_dir")
		backup_file="${backup_dir}/$(basename "$target").bak"
		run_root cp -a "$target" "$backup_file"
		BACKUPS["$target"]="$backup_file"
	else
		CREATED_FILES+=("$target")
	fi

	run_root install -m 0644 "$source" "$target"
}

write_caddy_config() {
	local domain="$1"
	local port="$2"
	local snippet_dir snippet_file import_line
	snippet_dir="$(caddy_snippet_dir)"
	snippet_file="$(caddy_snippet_file)"
	import_line="import ${snippet_dir}/*.caddy"
	log "configuring Caddy for ${domain}"
	run_root install -d -m 0755 "$snippet_dir"
	local tmp
	tmp="$(mktemp)"
	cat >"$tmp" <<EOF
${MANAGED_MARKER}
${domain} {
	encode zstd gzip
	reverse_proxy localhost:${port}
}
EOF
	write_managed_file "$snippet_file" "$tmp"
	rm -f "$tmp"

	if [[ ! -f "$CADDY_MAIN_FILE" ]]; then
		local main_tmp
		main_tmp="$(mktemp)"
		cat >"$main_tmp" <<EOF
${MANAGED_MARKER}
${import_line}
EOF
		run_root install -d -m 0755 "$(dirname "$CADDY_MAIN_FILE")"
		run_root install -m 0644 "$main_tmp" "$CADDY_MAIN_FILE"
		CREATED_FILES+=("$CADDY_MAIN_FILE")
		rm -f "$main_tmp"
	elif grep -qE '^[[:space:]]*import[[:space:]].*(Caddyfile\.d|conf\.d)/\*' "$CADDY_MAIN_FILE"; then
		log "existing Caddyfile already imports a snippet directory; leaving unchanged"
	else
		warn "existing Caddyfile does not import ${snippet_dir}; leaving unchanged"
		warn "add this line manually: ${import_line}"
		return 0
	fi
}

write_nginx_config() {
	local domain="$1"
	local port="$2"
	log "configuring nginx for ${domain}"
	run_root install -d -m 0755 "$NGINX_SITE_DIR"
	run_root install -d -m 0755 "$NGINX_ENABLED_DIR"
	local tmp
	tmp="$(mktemp)"
	cat >"$tmp" <<EOF
${MANAGED_MARKER}
server {
	listen 80;
	server_name ${domain};

	location / {
		proxy_pass http://localhost:${port};
		proxy_http_version 1.1;
		proxy_set_header Upgrade \$http_upgrade;
		proxy_set_header Connection "upgrade";
		proxy_set_header Host \$host;
		proxy_set_header X-Real-IP \$remote_addr;
		proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto \$scheme;
		proxy_read_timeout 3600;
		proxy_send_timeout 3600;
	}
}
EOF
	write_managed_file "$NGINX_SITE_FILE" "$tmp"
	rm -f "$tmp"
	if [[ -e "$NGINX_ENABLED_FILE" && ! -L "$NGINX_ENABLED_FILE" ]]; then
		die "${NGINX_ENABLED_FILE} exists and is not a symlink; refusing to overwrite"
	fi
	if ! [[ -L "$NGINX_ENABLED_FILE" ]]; then
		CREATED_FILES+=("$NGINX_ENABLED_FILE")
	fi
	run_root ln -sfn "$NGINX_SITE_FILE" "$NGINX_ENABLED_FILE"
	run_root nginx -t
	run_root systemctl reload nginx 2>/dev/null || run_root systemctl restart nginx
}

detect_proxy_mode() {
	if [[ "$PROXY_MODE" != "auto" ]]; then
		printf '%s' "$PROXY_MODE"
		return
	fi
	if command -v caddy >/dev/null 2>&1; then
		printf '%s' "caddy"
		return
	fi
	if command -v nginx >/dev/null 2>&1; then
		printf '%s' "nginx"
		return
	fi
	printf '%s' "none"
}

detect_existing_proxy_config() {
	local snippet_file
	snippet_file="$(caddy_snippet_file)"
	if [[ -f "$snippet_file" ]]; then
		PROXY_SMOKE_MODE="caddy"
		PROXY_SMOKE_DOMAIN="$(awk 'NR==2 { gsub(/[[:space:]]*\{.*$/, "", $0); print $0; exit }' "$snippet_file")"
		return 0
	fi
	if [[ -f "$NGINX_SITE_FILE" ]]; then
		PROXY_SMOKE_MODE="nginx"
		PROXY_SMOKE_DOMAIN="$(awk '/^[[:space:]]*server_name[[:space:]]+/ { sub(/^[[:space:]]*server_name[[:space:]]+/, "", $0); sub(/;[[:space:]]*$/, "", $0); print $0; exit }' "$NGINX_SITE_FILE")"
		return 0
	fi
	return 1
}

ensure_proxy_domain() {
	if [[ "$PROXY_MODE" == "none" ]]; then
		return
	fi
	if [[ -z "$DOMAIN" ]]; then
		if [[ "$NON_INTERACTIVE" == true || ! -t 0 ]]; then
			die "a domain is required when configuring a reverse proxy"
		fi
		DOMAIN="$(prompt "Reverse proxy hostname" "qdht.example.com")"
	fi
	if [[ -z "$DOMAIN" ]]; then
		die "a domain is required when configuring a reverse proxy"
	fi
}

configure_proxy() {
	local mode="$1"
	local port="$2"
	if [[ "$mode" == "none" ]]; then
		warn "no reverse proxy detected or requested; skipping proxy setup"
		return
	fi
	if [[ -z "$DOMAIN" ]]; then
		warn "skipping reverse proxy setup because no domain was provided"
		return
	fi
	case "$mode" in
		caddy)
			write_caddy_config "$DOMAIN" "$port"
			run_root caddy validate --config "$CADDY_MAIN_FILE"
			run_root systemctl reload caddy 2>/dev/null || run_root systemctl restart caddy
			;;
		nginx)
			write_nginx_config "$DOMAIN" "$port"
			;;
		*) die "unknown proxy mode: ${mode}" ;;
	esac
}

proxy_smoke_test() {
	local mode="$1"
	local domain="$2"
	if [[ -z "$domain" ]]; then
		warn "skipping proxy smoke test; no domain determined"
		return 0
	fi
	log "probing ${mode} proxy for ${domain}"
	case "$mode" in
		caddy)
			local ok=false
			for _ in $(seq 1 30); do
				if curl -fsS --noproxy '*' --max-time 20 -L -k \
					--resolve "${domain}:80:127.0.0.1" \
					--resolve "${domain}:443:127.0.0.1" \
					"https://${domain}/health" >/dev/null 2>&1; then
					ok=true
					break
				fi
				sleep 2
			done
			if [[ "$ok" != true ]]; then
				if systemctl is-active --quiet caddy 2>/dev/null; then
					warn "Caddy is active; TLS may still be provisioning — leaving install in place"
					return 0
				fi
				die "https proxy probe failed for ${domain}"
			fi
			;;
		nginx)
			local ok=false
			for _ in $(seq 1 15); do
				if curl -fsS --noproxy '*' --max-time 10 \
					--resolve "${domain}:80:127.0.0.1" \
					"http://${domain}/health" >/dev/null 2>&1; then
					ok=true
					break
				fi
				sleep 1
			done
			if [[ "$ok" != true ]]; then
				die "http proxy probe failed for ${domain}"
			fi
			;;
		*)
			warn "unknown proxy mode ${mode}; skipping proxy smoke test"
			return 0
			;;
	esac
	log "proxy smoke test passed for ${domain}"
}

# ── Systemd ───────────────────────────────────────────────────────────────────

ensure_system_user() {
	if ! id -u qdht >/dev/null 2>&1; then
		log "creating qdht system user"
		run_root useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin --user-group qdht
	fi
}

ensure_directories() {
	run_root install -d -m 0755 "$CONFIG_DIR"
	run_root install -d -m 0750 -o qdht -g qdht "$DATA_DIR"
}

write_service() {
	local port="$1"
	local quic_port="$2"
	local web_port="${3:-}"
	local web_args=""
	if [[ -n "$web_port" ]]; then
		web_args=" --web-port ${web_port}"
	fi
	log "writing systemd unit to ${SERVICE_FILE}"
	local tmp
	tmp="$(mktemp)"
	cat >"$tmp" <<EOF
[Unit]
Description=qDHT node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=qdht
Group=qdht
WorkingDirectory=${DATA_DIR}
Environment=NODE_ENV=production
ExecStart=${NODE_BIN} ${INSTALL_DIR}/dist/bin/qdht-node.js start --config ${CONFIG_FILE}${web_args}
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
EOF
	if [[ -f "$SERVICE_FILE" ]]; then
		local backup_dir backup_file
		backup_dir="$(mktemp -d)"
		TEMP_DIRS+=("$backup_dir")
		backup_file="${backup_dir}/$(basename "$SERVICE_FILE").bak"
		run_root cp -a "$SERVICE_FILE" "$backup_file"
		BACKUPS["$SERVICE_FILE"]="$backup_file"
	else
		CREATED_FILES+=("$SERVICE_FILE")
	fi
	run_root install -m 0644 "$tmp" "$SERVICE_FILE"
	rm -f "$tmp"
}

restart_service() {
	run_root systemctl daemon-reload
	run_root systemctl stop "$SERVICE_NAME" 2>/dev/null || true
	run_root systemctl enable --now "$SERVICE_NAME"
}

wait_for_node() {
	local port="$1"
	local url="http://127.0.0.1:${port}/health"
	local i
	log "waiting for node at ${url}"
	for i in $(seq 1 30); do
		if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
			log "node responded on port ${port}"
			return 0
		fi
		sleep 1
	done

	if command -v systemctl >/dev/null 2>&1; then
		warn "node did not respond; checking service status"
		run_root systemctl --no-pager --full status "$SERVICE_NAME" || true
	fi
	die "node did not respond at ${url}"
}

# ── Actions ───────────────────────────────────────────────────────────────────

install_action() {
	CURRENT_ACTION="install"
	require_root_tools
	check_node_version
	PROXY_MODE="$(detect_proxy_mode)"
	ensure_proxy_domain
	if is_true "$DRY_RUN"; then
		print_install_plan
		return
	fi
	ensure_sudo

	local port quic_port web_port
	port="${PORT_OVERRIDE:-$DEFAULT_PORT}"
	quic_port="${QUIC_PORT_OVERRIDE:-$DEFAULT_QUIC_PORT}"
	web_port="${WEB_PORT_OVERRIDE:-}"

	port="$(pick_free_port "$port")"
	quic_port="$(pick_free_port "$quic_port" "$port")"

	ensure_system_user
	ensure_directories
	build_app
	install_app
	write_config "$port" "$quic_port" "$web_port"
	write_service "$port" "$quic_port" "$web_port"
	configure_proxy "$PROXY_MODE" "$port"
	restart_service
	wait_for_node "$port"
	if [[ "$PROXY_MODE" != "none" && -n "$DOMAIN" ]]; then
		proxy_smoke_test "$PROXY_MODE" "$DOMAIN"
	fi
	log "install complete"
	if [[ -z "$(parse_config_field privkey)" ]]; then
		warn "no identity key in config; add identity.privkey to ${CONFIG_FILE} before the node can join the network"
	fi
}

update_action() {
	CURRENT_ACTION="update"
	require_root_tools
	check_node_version
	if is_true "$DRY_RUN"; then
		print_update_plan
		return
	fi
	ensure_sudo
	update_source
	run_root systemctl stop "$SERVICE_NAME" 2>/dev/null || true
	build_app
	install_app

	local port quic_port
	port="$(parse_config_field port)"
	port="${port:-$DEFAULT_PORT}"
	quic_port="$(parse_config_field quicListenPort)"
	quic_port="${quic_port:-$DEFAULT_QUIC_PORT}"
	web_port="$(parse_config_field webPort)"
	web_port="${web_port:-}"

	write_service "$port" "$quic_port" "$web_port"
	run_root systemctl daemon-reload
	run_root systemctl restart "$SERVICE_NAME"
	wait_for_node "$port"
	if detect_existing_proxy_config; then
		proxy_smoke_test "$PROXY_SMOKE_MODE" "$PROXY_SMOKE_DOMAIN"
	fi
	log "update complete"
}

test_action() {
	CURRENT_ACTION="test"
	require_root_tools
	if is_true "$DRY_RUN"; then
		print_test_plan
		return
	fi
	ensure_sudo
	run_root systemctl is-active --quiet "$SERVICE_NAME" || die "service ${SERVICE_NAME} is not active"
	local port
	port="$(parse_config_field port)"
	port="${port:-$DEFAULT_PORT}"
	wait_for_node "$port"
	if detect_existing_proxy_config; then
		proxy_smoke_test "$PROXY_SMOKE_MODE" "$PROXY_SMOKE_DOMAIN"
	fi
	log "smoke test passed"
}

# ── Arg parsing ───────────────────────────────────────────────────────────────

parse_args() {
	while (($#)); do
		case "$1" in
			install|update|test)
				ACTION="$1"
				;;
			--domain)
				shift
				[[ $# -gt 0 ]] || die "--domain requires a value"
				DOMAIN="$1"
				;;
			--domain=*)
				DOMAIN="${1#*=}"
				;;
			--proxy)
				shift
				[[ $# -gt 0 ]] || die "--proxy requires a value"
				PROXY_MODE="$1"
				;;
			--proxy=*)
				PROXY_MODE="${1#*=}"
				;;
			--port)
				shift
				[[ $# -gt 0 ]] || die "--port requires a value"
				PORT_OVERRIDE="$1"
				;;
			--port=*)
				PORT_OVERRIDE="${1#*=}"
				;;
			--quic-port)
				shift
				[[ $# -gt 0 ]] || die "--quic-port requires a value"
				QUIC_PORT_OVERRIDE="$1"
				;;
			--quic-port=*)
				QUIC_PORT_OVERRIDE="${1#*=}"
				;;
			--web-port)
				shift
				[[ $# -gt 0 ]] || die "--web-port requires a value"
				WEB_PORT_OVERRIDE="$1"
				;;
			--web-port=*)
				WEB_PORT_OVERRIDE="${1#*=}"
				;;
			--non-interactive)
				NON_INTERACTIVE=true
				;;
			--dry-run)
				DRY_RUN=true
				;;
			-h|--help)
				usage
				exit 0
				;;
			*)
				die "unknown argument: $1"
				;;
		esac
		shift
	done
}

main() {
	parse_args "$@"

	case "$ACTION" in
		install) install_action ;;
		update) update_action ;;
		test) test_action ;;
		*) die "unknown action: ${ACTION}" ;;
	esac
}

main "$@"
