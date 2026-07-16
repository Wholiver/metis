import type { ResolvedUiLanguage } from "../../../core/ui-language.ts";
import { getUiLanguage } from "./index.ts";

const en = {
	"autocompact":"Auto-compact","steering-mode":"Steering mode","follow-up-mode":"Follow-up mode","transport":"Transport",
	"http-idle-timeout":"HTTP idle timeout","hide-thinking":"Hide thinking","collapse-changelog":"Collapse changelog","quiet-startup":"Quiet startup",
	"install-telemetry":"Install telemetry","default-project-trust":"Default project trust","double-escape-action":"Double-escape action",
	"tree-filter-mode":"Tree filter mode","warnings":"Warnings","thinking":"Thinking level","theme":"Theme","show-images":"Show images",
	"image-width-cells":"Image width","auto-resize-images":"Auto-resize images","block-images":"Block images","skill-commands":"Skill commands",
	"show-hardware-cursor":"Show hardware cursor","editor-padding":"Editor padding","output-padding":"Output padding",
	"autocomplete-max-visible":"Autocomplete max items","clear-on-shrink":"Clear on shrink","terminal-progress":"Terminal progress",
} as const;

export type SettingLabelId = keyof typeof en;
type SettingLabels = Record<SettingLabelId, string>;

const catalogs: Record<ResolvedUiLanguage, SettingLabels> = {
	en,
	"zh-CN": {
		"autocompact":"自动压缩","steering-mode":"引导消息模式","follow-up-mode":"后续消息模式","transport":"传输方式",
		"http-idle-timeout":"HTTP 空闲超时","hide-thinking":"隐藏思考内容","collapse-changelog":"折叠更新日志","quiet-startup":"安静启动",
		"install-telemetry":"安装遥测","default-project-trust":"默认项目信任","double-escape-action":"双击 Escape 操作",
		"tree-filter-mode":"会话树筛选模式","warnings":"警告","thinking":"思考级别","theme":"主题","show-images":"显示图片",
		"image-width-cells":"图片宽度","auto-resize-images":"自动缩放图片","block-images":"阻止图片","skill-commands":"技能命令",
		"show-hardware-cursor":"显示硬件光标","editor-padding":"编辑器内边距","output-padding":"输出内边距",
		"autocomplete-max-visible":"自动补全最大项数","clear-on-shrink":"缩小时清空","terminal-progress":"终端进度",
	},
	"zh-TW": {
		"autocompact":"自動壓縮","steering-mode":"引導訊息模式","follow-up-mode":"後續訊息模式","transport":"傳輸方式",
		"http-idle-timeout":"HTTP 閒置逾時","hide-thinking":"隱藏思考內容","collapse-changelog":"折疊更新紀錄","quiet-startup":"安靜啟動",
		"install-telemetry":"安裝遙測","default-project-trust":"預設專案信任","double-escape-action":"雙擊 Escape 操作",
		"tree-filter-mode":"工作階段樹篩選模式","warnings":"警告","thinking":"思考等級","theme":"主題","show-images":"顯示圖片",
		"image-width-cells":"圖片寬度","auto-resize-images":"自動縮放圖片","block-images":"阻止圖片","skill-commands":"技能命令",
		"show-hardware-cursor":"顯示硬體游標","editor-padding":"編輯器內距","output-padding":"輸出內距",
		"autocomplete-max-visible":"自動完成最大項目數","clear-on-shrink":"縮小時清空","terminal-progress":"終端機進度",
	},
	ja: {
		"autocompact":"自動圧縮","steering-mode":"ステアリングモード","follow-up-mode":"フォローアップモード","transport":"転送方式",
		"http-idle-timeout":"HTTP アイドルタイムアウト","hide-thinking":"思考を非表示","collapse-changelog":"変更履歴を折りたたむ","quiet-startup":"静かな起動",
		"install-telemetry":"インストールテレメトリ","default-project-trust":"既定のプロジェクト信頼","double-escape-action":"Escape 2回の操作",
		"tree-filter-mode":"ツリーフィルターモード","warnings":"警告","thinking":"思考レベル","theme":"テーマ","show-images":"画像を表示",
		"image-width-cells":"画像幅","auto-resize-images":"画像を自動リサイズ","block-images":"画像をブロック","skill-commands":"スキルコマンド",
		"show-hardware-cursor":"ハードウェアカーソルを表示","editor-padding":"エディター余白","output-padding":"出力余白",
		"autocomplete-max-visible":"自動補完の最大項目数","clear-on-shrink":"縮小時に消去","terminal-progress":"ターミナル進捗",
	},
	ko: {
		"autocompact":"자동 압축","steering-mode":"조정 메시지 모드","follow-up-mode":"후속 메시지 모드","transport":"전송 방식",
		"http-idle-timeout":"HTTP 유휴 시간 제한","hide-thinking":"사고 내용 숨기기","collapse-changelog":"변경 기록 접기","quiet-startup":"조용한 시작",
		"install-telemetry":"설치 원격 측정","default-project-trust":"기본 프로젝트 신뢰","double-escape-action":"Escape 두 번 동작",
		"tree-filter-mode":"트리 필터 모드","warnings":"경고","thinking":"사고 수준","theme":"테마","show-images":"이미지 표시",
		"image-width-cells":"이미지 너비","auto-resize-images":"이미지 자동 크기 조정","block-images":"이미지 차단","skill-commands":"스킬 명령",
		"show-hardware-cursor":"하드웨어 커서 표시","editor-padding":"편집기 여백","output-padding":"출력 여백",
		"autocomplete-max-visible":"자동 완성 최대 항목","clear-on-shrink":"축소 시 지우기","terminal-progress":"터미널 진행률",
	},
	es: {
		"autocompact":"Compactación automática","steering-mode":"Modo de dirección","follow-up-mode":"Modo de seguimiento","transport":"Transporte",
		"http-idle-timeout":"Tiempo de espera HTTP","hide-thinking":"Ocultar razonamiento","collapse-changelog":"Contraer cambios","quiet-startup":"Inicio silencioso",
		"install-telemetry":"Telemetría de instalación","default-project-trust":"Confianza predeterminada","double-escape-action":"Acción de doble Escape",
		"tree-filter-mode":"Filtro del árbol","warnings":"Advertencias","thinking":"Nivel de razonamiento","theme":"Tema","show-images":"Mostrar imágenes",
		"image-width-cells":"Ancho de imagen","auto-resize-images":"Redimensionar imágenes","block-images":"Bloquear imágenes","skill-commands":"Comandos de habilidades",
		"show-hardware-cursor":"Mostrar cursor físico","editor-padding":"Margen del editor","output-padding":"Margen de salida",
		"autocomplete-max-visible":"Máximo de autocompletado","clear-on-shrink":"Limpiar al reducir","terminal-progress":"Progreso del terminal",
	},
	fr: {
		"autocompact":"Compactage automatique","steering-mode":"Mode de guidage","follow-up-mode":"Mode de suivi","transport":"Transport",
		"http-idle-timeout":"Délai d’inactivité HTTP","hide-thinking":"Masquer la réflexion","collapse-changelog":"Réduire le journal","quiet-startup":"Démarrage silencieux",
		"install-telemetry":"Télémétrie d’installation","default-project-trust":"Confiance projet par défaut","double-escape-action":"Action double Échap",
		"tree-filter-mode":"Filtre de l’arbre","warnings":"Avertissements","thinking":"Niveau de réflexion","theme":"Thème","show-images":"Afficher les images",
		"image-width-cells":"Largeur d’image","auto-resize-images":"Redimensionner les images","block-images":"Bloquer les images","skill-commands":"Commandes de compétences",
		"show-hardware-cursor":"Afficher le curseur matériel","editor-padding":"Marge de l’éditeur","output-padding":"Marge de sortie",
		"autocomplete-max-visible":"Maximum d’autocomplétion","clear-on-shrink":"Effacer au rétrécissement","terminal-progress":"Progression du terminal",
	},
	de: {
		"autocompact":"Automatisch komprimieren","steering-mode":"Steuerungsmodus","follow-up-mode":"Folgemodus","transport":"Transport",
		"http-idle-timeout":"HTTP-Leerlaufzeit","hide-thinking":"Denken ausblenden","collapse-changelog":"Änderungen einklappen","quiet-startup":"Stiller Start",
		"install-telemetry":"Installations-Telemetrie","default-project-trust":"Standard-Projektvertrauen","double-escape-action":"Doppel-Escape-Aktion",
		"tree-filter-mode":"Baumfiltermodus","warnings":"Warnungen","thinking":"Denkstufe","theme":"Theme","show-images":"Bilder anzeigen",
		"image-width-cells":"Bildbreite","auto-resize-images":"Bilder automatisch skalieren","block-images":"Bilder blockieren","skill-commands":"Skill-Befehle",
		"show-hardware-cursor":"Hardware-Cursor anzeigen","editor-padding":"Editor-Innenabstand","output-padding":"Ausgabe-Innenabstand",
		"autocomplete-max-visible":"Maximale Autovervollständigung","clear-on-shrink":"Beim Verkleinern löschen","terminal-progress":"Terminalfortschritt",
	},
	pt: {
		"autocompact":"Compactação automática","steering-mode":"Modo de direção","follow-up-mode":"Modo de acompanhamento","transport":"Transporte",
		"http-idle-timeout":"Tempo ocioso HTTP","hide-thinking":"Ocultar raciocínio","collapse-changelog":"Recolher alterações","quiet-startup":"Inicialização silenciosa",
		"install-telemetry":"Telemetria de instalação","default-project-trust":"Confiança padrão do projeto","double-escape-action":"Ação de Escape duplo",
		"tree-filter-mode":"Filtro da árvore","warnings":"Avisos","thinking":"Nível de raciocínio","theme":"Tema","show-images":"Mostrar imagens",
		"image-width-cells":"Largura da imagem","auto-resize-images":"Redimensionar imagens","block-images":"Bloquear imagens","skill-commands":"Comandos de habilidades",
		"show-hardware-cursor":"Mostrar cursor físico","editor-padding":"Margem do editor","output-padding":"Margem de saída",
		"autocomplete-max-visible":"Máximo do preenchimento automático","clear-on-shrink":"Limpar ao reduzir","terminal-progress":"Progresso do terminal",
	},
	ru: {
		"autocompact":"Автосжатие","steering-mode":"Режим управления","follow-up-mode":"Режим продолжения","transport":"Транспорт",
		"http-idle-timeout":"Тайм-аут HTTP","hide-thinking":"Скрыть рассуждение","collapse-changelog":"Свернуть изменения","quiet-startup":"Тихий запуск",
		"install-telemetry":"Телеметрия установки","default-project-trust":"Доверие к проекту по умолчанию","double-escape-action":"Действие двойного Escape",
		"tree-filter-mode":"Фильтр дерева","warnings":"Предупреждения","thinking":"Уровень рассуждения","theme":"Тема","show-images":"Показывать изображения",
		"image-width-cells":"Ширина изображения","auto-resize-images":"Автомасштаб изображений","block-images":"Блокировать изображения","skill-commands":"Команды навыков",
		"show-hardware-cursor":"Показывать аппаратный курсор","editor-padding":"Отступ редактора","output-padding":"Отступ вывода",
		"autocomplete-max-visible":"Максимум автодополнения","clear-on-shrink":"Очищать при уменьшении","terminal-progress":"Прогресс терминала",
	},
	it: {
		"autocompact":"Compattazione automatica","steering-mode":"Modalità guida","follow-up-mode":"Modalità seguito","transport":"Trasporto",
		"http-idle-timeout":"Timeout inattività HTTP","hide-thinking":"Nascondi ragionamento","collapse-changelog":"Comprimi modifiche","quiet-startup":"Avvio silenzioso",
		"install-telemetry":"Telemetria installazione","default-project-trust":"Attendibilità predefinita","double-escape-action":"Azione doppio Escape",
		"tree-filter-mode":"Filtro albero","warnings":"Avvisi","thinking":"Livello di ragionamento","theme":"Tema","show-images":"Mostra immagini",
		"image-width-cells":"Larghezza immagine","auto-resize-images":"Ridimensiona immagini","block-images":"Blocca immagini","skill-commands":"Comandi skill",
		"show-hardware-cursor":"Mostra cursore hardware","editor-padding":"Margine editor","output-padding":"Margine output",
		"autocomplete-max-visible":"Massimo completamento automatico","clear-on-shrink":"Pulisci alla riduzione","terminal-progress":"Avanzamento terminale",
	},
};

export function translateSettingLabel(id: string, fallback: string): string {
	return id in en ? catalogs[getUiLanguage()][id as SettingLabelId] : fallback;
}

export function getSettingLabelCatalogs(): Readonly<Record<ResolvedUiLanguage, SettingLabels>> {
	return catalogs;
}
