# 공동 개발

`main`은 0.4.0 기준 소스이며 `feature/explorer-0.5-sftp` 브랜치에 현재 0.6.0 수정까지 이어집니다. 이 브랜치를 확장할 때는 여기서 새 작업 브랜치를 분기하고 PR 대상도 동일하게 지정하세요. main 병합 이후에는 main에서 분기합니다.

Windows에서 Node.js 24 LTS와 OpenSSH 클라이언트를 설치합니다.

```powershell
npm ci
npm run check
npm test
npm run desktop
```

- 변경 이유, 검증 결과, 알려진 제한을 PR에 기록합니다. 공유 브랜치에 강제 푸시하지 않습니다.
- 의존성 변경 시 package.json과 package-lock.json을 함께 커밋합니다.
- Windows CI는 문법·백엔드 테스트를 수행합니다. GUI·포터블 동작은 별도로 검증합니다.
- UI 검사는 개발 서버 실행 후 `node .checks/verify-ssh-workspace.cjs`를 사용합니다. Playwright와 Edge가 필요하며 설치된 Playwright가 있는 node_modules 경로를 첫 인수로 지정할 수도 있습니다.
- 실행 파일, 캐시, 테스트 산출물, 사용자 설정, 개인키는 Git에서 제외합니다. 실제 계정 정보를 테스트에 넣지 않습니다.
