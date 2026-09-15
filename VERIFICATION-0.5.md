# pane 0.5.0 검증

검증일: 2026-09-15. 제품 코드와 Windows x64 포터블 패키지를 대상으로 검사했다.

## 구현 범위

- Windows 파일 클립보드: WinForms의 CF_HDROP 및 Preferred DropEffect
- 파일 충돌 정책: 건너뛰기, 백업 후 교체, 폴더 병합, 병합과 교체
- 일시정지·재개·취소: 파일 경계에서 적용, 네이티브 복사로 NTFS 추가 스트림 유지
- 실행 취소: 이번 실행의 복사·이동·이름 변경·새 폴더. 변경된 대상은 거부
- 교체 백업과 원래 경로 JSON 기록 유지
- 폴더 수정 날짜 보존, 파일 목록 가상화·정렬 캐시, 표시 패널 지연 조회
- 폴더 변경 알림, 창 복귀 시 드라이브 갱신, 중복 조회 공유 및 조회 제한 시간
- 작업 공간 추가·이름 변경, 패널별 탭과 v1→v2 세션 복원
- 폴더 트리, 텍스트·이미지 미리보기, ZIP 검색·개별 추출
- Windows 셸 IContextMenu 및 IContextMenu2/3 메시지 전달
- SSH/SFTP 연결, 서버 키 확인·변경 차단, 비밀번호·개인키 인증, 파일·폴더 양방향 복사

## 실행한 검사

| 검사 | 결과 |
| --- | --- |
| JavaScript 문법 | 통과 |
| 기존 및 신규 백엔드·SFTP 테스트 | 46개 전체 통과, ZIP 회귀 1개 추가 통과: 총 47개 |
| 실제 다른 드라이브로 파일·폴더 이동 | 임시 C: 폴더를 지정하여 통과 |
| 브라우저 기존 UI·실제 마우스 | 8개 그룹 통과 |
| 새 UI | 가상화·Home/End·탭·작업 공간·HTML 이스케이프·미리보기·SFTP 폼 및 다운로드 대상 전달 통과 |
| 실제 앱 기본 작업 | 7개 그룹 통과: 실제 복사·이동·이름 변경·휴지통·마우스 드래그·고정 크기 |
| 실제 앱 추가 기능 | 파일 감시·CF_HDROP 클립보드·교체와 실행 취소·작업 공간/탭 재시작 복원 통과 |
| 실제 SSH/SFTP | 로컬 SSH 서버와 실제 암호화 연결, 다운로드·업로드·충돌 보호·서버 키 변경 차단 통과 |
| Windows 셸 메뉴 | 실제 IShellFolder/IContextMenu 연결 및 메뉴 24개 조회 통과 |
| ZIP 추출 | 상위 경로를 포함하는 ZIP 이름이 선택 폴더 밖으로 나가지 않음, 기존 대상 거부 통과 |
| 패키지 내부 코드 | 현재 실행 코드·HTML·CSS·PS1·C#과 바이트 일치 확인 |
| 최종 포터블 EXE | 첫 실행·재실행·EXE와 설정을 함께 옮긴 후 실행 모두 통과, 종료 코드 0 |

## 기록

- `.checks/browser-files/run-1789434881472/result.json`
- `.checks/enhanced-ui-1789434768405/result.json`
- `.checks/explorer/run-1789434798028/result.json`
- `.checks/native-enhanced-1789435191876/result.json`
- 최종 패키지 기본 그래픽 설정 검사: `.checks/explorer/run-1789435333549/result.json` — 7개 그룹 통과, 런타임 오류 없음, 아래 ASAR 해시와 일치
- 최종 포터블 런처: `.checks/portable-launch/run-1789435541258/result.json` — 아래 EXE 해시와 일치, 3회 정상 실행·종료, 경로·분할·즐겨찾기·테마 복원

브라우저 검사에는 테스트 전용 파일 연결 API를 주입했다. 실제 파일 변경과 클립보드는 별도 네이티브 검사로 확인했다. 네이티브 기본 앱 열기·외부 드래그 호출은 기존 검사에서 가로챘으며 실제 외부 프로그램 동작의 검증으로 간주하지 않는다.

## 환경과 한계

- 제한된 실행 환경에서는 Electron GPU 프로세스 오류와 연결 시간 초과가 발생했다. 일반 실행 권한으로 실제 앱 검사를 통과했다.
- 숨김 네이티브 창의 스크린샷은 시간 초과되어 제거했다. 브라우저 캡처를 시각 확인하고 네이티브는 접근성·실제 파일 결과·창 좌표로 확인했다.
- 사용자의 실제 원격 서버, 점프 호스트, SSH 에이전트, 키보드 대화식 인증, X11 및 터미널은 검증/구현 범위 밖이다.
- Windows 메뉴는 실제 항목 조회와 연결을 확인했으며 설치 가능한 모든 제3자 확장의 명령 완료를 확인한 것은 아니다.
- SFTP는 원본을 보존하는 복사이며 중단 실패 시 부분 대상이 남을 수 있다. SFTP 취소·재개·실행 취소는 없다.
- ZIP만 지원한다. 미리보기는 텍스트·소스 코드와 지정된 래스터 이미지 형식만 지원한다.
- 제품 코드 변경 중에는 단계별 패키지 검사를 실행했다. 최종 패키지 검증 기록은 아래 배포 기록을 기준으로 한다.

## 재현

```powershell
npm run check
$env:PANE_TEST_CROSS_VOLUME_DIR = Join-Path $env:TEMP 'pane-enhancement-cross-volume'
npm test
node .checks/verify-browser-files.cjs '<Playwright node_modules 절대 경로>'
node .checks/verify-enhanced-ui.cjs '<Playwright node_modules 절대 경로>'
node .checks/verify-explorer.cjs '<Playwright node_modules 절대 경로>' --mouse-drag
node .checks/verify-native-enhancements.cjs '<Playwright node_modules 절대 경로>'
node desktop/verify-launcher.cjs '<Playwright node_modules 절대 경로>'
```

빌드 환경에 Electron 다운로드가 없어 이전 배포의 동일 Electron 44.3.0 런타임을 `.cache/electron-dist`에 복사해 사용했다. 코드 서명은 하지 않았다. 파일 버전과 제품 버전은 0.5.0으로 갱신했다. SSH의 선택적 CPU 최적화 모듈은 재빌드하지 않으며 순수 JavaScript 경로를 사용한다.

## 최종 배포 기록

- 파일: `dist-portable/pane-0.5.0-portable-x64.exe`
- 크기: 109,645,823 bytes
- EXE SHA256: `750D21D071126F82FD22CFCAB902CAED65B088972B563FDFAF7B36D698A57F6C`
- ASAR SHA256: `A65BFA436AEA20910D663DC775253F8C63981858940A2B56A739228B5564D438`
- 빌드 종료 코드: 0
- 실행 코드·HTML·CSS 및 별도 Windows PS1/C# 도우미의 소스/패키지 바이트 비교: 모두 일치
