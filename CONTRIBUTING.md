# 공동 개발

## 버전과 브랜치

- `main`: 업데이트 전 0.4.0 기준 소스.
- `feature/explorer-0.5-sftp`: 0.5.0 탐색기 개선과 SSH/SFTP 변경.
- 새 기능은 작업 브랜치에서 개발하고 Pull Request로 검토 후 병합합니다.
- 0.5.0이 main에 병합되기 전 해당 기능을 확장하려면 0.5.0 브랜치에서 분기하고 PR 대상도 그 브랜치로 지정합니다.
- 공유 브랜치에 강제 푸시하지 않습니다.

## 개발 환경

Windows에서 Node.js 24 LTS와 npm을 설치한 뒤 실행합니다.

```powershell
npm ci
npm run check
npm test
npm run desktop
```

포터블 실행 파일은 `npm run build:portable`로 생성합니다.
의존성을 변경할 때 `package.json`과 `package-lock.json`을 함께 커밋합니다.

## 검증

PR에 변경 이유, 검증 결과, 알려진 제한을 기록합니다. 자동 검사는 문법 검사와 백엔드 테스트를 실행합니다. Windows 클립보드, 셸 메뉴, 창 동작, 포터블 실행은 별도 실제 Windows 검증이 필요합니다. 수동·통합 검증 내역은 `VERIFICATION-0.5.md`에 있습니다.

## 업로드 제외

의존성, 빌드 결과, 캐시, 테스트 산출물, 사용자 설정, SSH 개인키 및 환경 파일은 `.gitignore`로 제외합니다. 실제 서버 계정이나 비밀번호를 코드와 테스트에 넣지 마세요. 배포 실행 파일은 소스 커밋 대신 GitHub Releases 첨부 파일로 관리합니다.
