#!/usr/bin/env bash
#
# manager 정기 백업 — 일감 첨부 업로드 디렉터리 + 복구 불가능한 비밀값.
#
# 왜 필요한가: DB(RDS)는 자동 백업이 있지만 아래 셋은 DB에 없다.
#   1. 첨부 파일 실체       /var/www/manager/uploads
#   2. OIDC 서명키          <app>/server/keys/oidc-private.pem
#   3. 서버 환경변수         <app>/server/.env
# 1이 없으면 일감에 첨부 목록은 보이는데 받을 수 없고, 2가 없으면 게시판 로그인이
# 조용히 깨지고(같은 kid로 새 키가 생겨 BookStack 캐시와 어긋난다), 3의
# FIELD_ENCRYPTION_KEY가 없으면 사용자 이름·이메일을 영영 복호화할 수 없다.
#
# **이 tar에는 비밀값이 들어 있다.** 버킷은 퍼블릭 액세스 차단 + 버전관리 + SSE로
# 두고, 쓰기 권한은 이 서버에만 준다(server/DEPLOY.md 14단계).
#
# 실행: root로. 대상 디렉터리가 manager 계정 소유(drwxr-x---)라 다른 계정은 읽지
# 못한다. 보관 기간은 이 스크립트가 아니라 S3 라이프사이클이 관리한다 — 스크립트가
# 아무것도 지우지 않으므로 여기 버그가 백업을 날릴 수 없다.
#
# 사용법:
#   BACKUP_S3_BUCKET=my-bucket /var/www/manager/app/server/scripts/backup-manager.sh
#
set -euo pipefail

BUCKET="${BACKUP_S3_BUCKET:-}"
PREFIX="${BACKUP_S3_PREFIX:-manager}"
UPLOAD_DIR="${BACKUP_UPLOAD_DIR:-/var/www/manager/uploads}"
APP_DIR="${BACKUP_APP_DIR:-/var/www/manager/app}"
REGION="${AWS_REGION:-ap-northeast-2}"
LOCK_FILE="${BACKUP_LOCK_FILE:-/var/lock/manager-backup.lock}"

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
die() { echo "[backup] ERROR: $*" >&2; exit 1; }

[ -n "$BUCKET" ] || die "BACKUP_S3_BUCKET이 설정되지 않았습니다"
command -v aws >/dev/null 2>&1 || die "aws CLI가 없습니다 (apt install awscli 또는 공식 설치본)"
[ -d "$UPLOAD_DIR" ] || die "업로드 디렉터리가 없습니다: $UPLOAD_DIR"

# 겹쳐 돌지 않게. cron이 겹치거나 손으로 한 번 더 돌려도 두 번째는 즉시 빠진다.
exec 9>"$LOCK_FILE"
flock -n 9 || die "이미 다른 백업이 실행 중입니다"

STAMP="$(date -u '+%Y-%m-%d')"
TIME="$(date -u '+%H%M%S')"
DEST="s3://${BUCKET}/${PREFIX}/${STAMP}"

# 비밀값이 잠시 평문으로 놓이는 자리 — 700으로 만들고 끝나면 반드시 지운다.
WORK="$(mktemp -d)"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

log "시작 — 대상 $DEST"

# 1) 업로드 디렉터리. -C로 부모에서 묶어 압축 파일 안의 경로를 uploads/... 로 둔다
#    (복원할 때 tar -xzf ... -C /var/www/manager 한 줄이 되도록).
UPLOAD_TAR="$WORK/uploads-${STAMP}-${TIME}.tar.gz"
tar -czf "$UPLOAD_TAR" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
log "업로드 묶음 $(du -h "$UPLOAD_TAR" | cut -f1)"

# 2) 비밀값. keys/와 .env는 같은 디렉터리(server/)에 있으므로 한 번에 묶는다.
SECRET_TAR="$WORK/secrets-${STAMP}-${TIME}.tar.gz"
( cd "$APP_DIR/server" && tar -czf "$SECRET_TAR" keys .env )
chmod 600 "$SECRET_TAR"
log "비밀값 묶음 $(du -h "$SECRET_TAR" | cut -f1)"

# 3) 업로드. --sse로 서버 측 암호화를 명시한다(버킷 기본값에 기대지 않는다).
for f in "$UPLOAD_TAR" "$SECRET_TAR"; do
  aws s3 cp "$f" "$DEST/" --region "$REGION" --sse AES256 --only-show-errors
  log "업로드 완료 $(basename "$f")"
done

# 4) 복원 시 DB 시점을 맞출 수 있도록 이 백업의 시각을 같이 남긴다.
#    첨부 파일명은 디스크에서 무작위 hex라, DB의 TaskAttachment 행이 없으면
#    어떤 파일이 무엇인지 알 수 없다 — 복원은 항상 RDS 스냅샷/PITR과 짝이다.
printf 'backup_utc=%sT%sZ\nuploads=%s\napp=%s\n' \
  "$STAMP" "$TIME" "$UPLOAD_DIR" "$APP_DIR" > "$WORK/manifest.txt"
aws s3 cp "$WORK/manifest.txt" "$DEST/manifest-${TIME}.txt" \
  --region "$REGION" --sse AES256 --only-show-errors

log "끝 — $DEST"
