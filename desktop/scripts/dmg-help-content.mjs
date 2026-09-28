export const HELP_FOLDER_NAME = "Cannot Open? (打不开？)";
export const HELP_FILE_NAME = "How-to-Open (打不开点我).txt";

export function getOpenHelpText() {
	return `================================================================================
  Metis for macOS — How to Open & Troubleshooting / 安装与打开说明
================================================================================

[ IMPORTANT / 前置必要步骤 ]
Before doing anything below, you MUST drag "Metis.app" into the "Applications" folder!
Do NOT run Terminal commands or run Metis directly inside this DMG disk image.

进行以下任何操作前，请务必先将“Metis.app”拖入“Applications”（应用程序）文件夹中！
请勿直接在 DMG 磁盘镜像内运行终端命令或直接运行。

--------------------------------------------------------------------------------
1. “Metis is damaged and can't be opened” / “Metis 已损坏，无法打开”
--------------------------------------------------------------------------------
[ Cause / 原因 ]
macOS Gatekeeper automatically quarantines apps downloaded from the web. Because Metis
is currently self-signed (ad-hoc signed), macOS may report it as "damaged".

macOS 的 Gatekeeper 安全机制会自动对从网络下载的文件添加隔离标记（quarantine）。
由于 Metis 目前使用自签名（ad-hoc），系统有时会误报应用“已损坏”。

[ Solution / 解决方法 ]
Open "Terminal" (终端) app on your Mac, copy & paste the following command, and press Enter:

打开 Mac 的“终端”（Terminal）应用，复制并粘贴以下命令，然后按回车：

    xattr -cr /Applications/Metis.app

* If Terminal prompts "Permission denied", run with administrator privileges:
* 如果终端提示“Permission denied”（权限不足），请使用管理员权限执行：

    sudo xattr -cr /Applications/Metis.app
    (Type your Mac login password when prompted and press Enter; characters won't show)
    （输入您的 Mac 登录密码并按回车；输入过程中屏幕上不会显示字符）

After running the command, open Metis from Launchpad or Applications normally.
执行完毕后，即可从“启动台”或“访达 > 应用程序”正常打开 Metis。

--------------------------------------------------------------------------------
2. “Apple cannot check it for malicious software” / “无法验证开发者”
--------------------------------------------------------------------------------
[ Cause / 原因 ]
Metis is not notarized through Apple's paid Developer Program yet.

Metis 尚未加入 Apple 付费开发者公证计划，因此系统会弹出未验证开发者提示。

[ Solution (macOS 13 / 14 / 15 Sequoia) / 官方系统设置解决方法 ]
1. Try to open Metis from /Applications once (it will show the alert; click OK / Cancel).
2. Open macOS "System Settings" (系统设置) > "Privacy & Security" (隐私与安全性).
3. Scroll down to the "Security" (安全性) section.
4. You will see: "“Metis.app” was blocked...". Click the "Open Anyway" (仍要打开) button.
5. Enter your Mac password if prompted, then click "Open" (打开).

1. 在“应用程序”中尝试打开一次 Metis（会弹出警告弹窗，点击“好”或“取消”）。
2. 打开 Mac“系统设置” > 找到“隐私与安全性”。
3. 向下滚动到“安全性”区域。
4. 找到提示“已阻止使用 Metis.app...”，点击其右侧的“仍要打开”按钮。
5. 按提示输入 Mac 密码，在弹窗中再次点击“打开”即可。

* Note: On macOS 15 Sequoia, Apple removed the old Control-click bypass. Use the System Settings steps above.
* 注意：macOS 15 Sequoia 已移除按住 Control 键直接打开的旧机制，请统一在“系统设置”中放行。

--------------------------------------------------------------------------------
3. Immediate Crash on Apple Silicon (M1 / M2 / M3 / M4) / 芯片架构签名修复
--------------------------------------------------------------------------------
If Metis closes immediately upon launch on Apple Silicon Macs, the local signature
may need to be refreshed. Run in Terminal:

若在 Apple Silicon（M 系列芯片）上打开时发生闪退，可打开终端运行以下命令重新签名：

    codesign --force --deep --sign - /Applications/Metis.app

================================================================================
Official Apple Guide / Apple 官方技术支持指南:
https://support.apple.com/guide/mac-help/mh40616/mac
================================================================================
`;
}
