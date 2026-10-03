# ローカル領収書候補抽出の検証

対象は原始請求取り込みの tree `11046f29843aab9b7283de0374cb62a881de5eab` からの追加実装。文字付きPDF・ラベル付きUTF-8テキスト・指定JSONから未確認候補を選択し、既存の原始請求候補確認・影響確認・原子的workspace保存へ接続する。画像OCR、汎用請求書認識、外部AI/OCR通信、税務分類の自動判定は含まない。

## 確認した境界

- 未選択候補と原文はメモリのみ。照合した短いフィールドだけを共通入力へ渡す。原文・ファイル名・パスを控え・DTO・年度資料へ複製しない。
- 発行元・請求書番号を任意のstrict document項目へ保存し、契約番号とは区別する。旧事実から項目を落とす書込みは、候補hashを計算し直しても拒否する。
- 同じ文書/候補の繰返しは既存キー照合で加算しない。同額の文書番号訂正を検出し、過年度の採用済みpayload・hash・出力を維持する。
- キャンセル、別ファイル、画面移動、版変更、アンマウント、時間切れ後の結果を破棄する。選択後の入力控えは復旧でき、長すぎる編集値も読めない控えに変えない。
- 本物の合成PDFの複数ページ、破損、文字なし、パスワードあり、空パスワード暗号化を確認。5 MiB・20ページ・512 KiB・20,000項目・15秒の制限を確認。
- ネイティブmodule Workerを明示し、byte-only入力・同一オリジンasset・補助リソース取得拒否・停止/破棄を検査。fake workerへフォールバックしない。PDF.js6のmodern buildにあったNode24のtoHex非互換を、同梱legacy main/workerで解消した。
- PDF.jsの公開イベント識別子一つだけを、名前を限定したPDF bundleのUUID検査で例外化した。任意の別UUID、同一asset内の追加UUID、別の場所は引き続き拒否する。
- 配布ZIPでPDF library/workerとライセンスが同梱され、起動したローカルHTTPサーバーが元と同じバイト・JavaScript MIMEを返すことを確認。確認済み発行元/番号の保存・projection・backup・復元・再起動、固定資料のoffline読取りを確認。

## 実行環境とゲート

Node 24.19.0、lockfileの依存で検証。npm test、typecheck、build、lint、format:check、docs:checkを実行。privacy:checkとrelease:packのnpm CLIはこの環境のtsx IPC制約（EPERM）で起動できないため、同じスクリプトを `node --import tsx scripts/privacy-check.ts` と `node --import tsx scripts/package-release.ts` で実行した。検査内容を省略していない。lintは既存の警告、buildは既存の大きなchunkの警告を残す。

PDF.js 6.3.289を固定。`npm audit --omit=dev` は0件。開発依存を含む `npm audit` は中5・高6の11件で、原始請求取り込みbaselineと同一、新規PDF依存の指摘はない。監査結果に自動修正候補はなかった。これを「全依存に脆弱性なし」とは表現しない。PDF.js Apache2.0とlegacy内core-js MITのライセンス・noticeをdocsと公開assetsへ同梱する。

独立レビューで、PDF runtime互換性と長いmetadata編集の復旧不整合を指摘し修正。修正後、保存・プライバシー・リソース終了・重複・固定資料の境界にblocking findingなし。

## 未実施の確認

実ブラウザでのネイティブWorker実行、狭幅/キーボードを含む視覚操作、Windows実機は未実施。コンポーネント・Worker境界mock・本物のPDF parser API・パッケージHTTP試験は、その代わりの実機合格証拠ではない。すべてのPDF生成製品や字体を保証しない。

この記録はローカル検証の記録であり、PR公開、merge、配布リリース、デプロイを示さない。
