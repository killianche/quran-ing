import UIKit
import Capacitor

/// Подкласс моста Capacitor для нативной настройки WKWebView.
///
/// Проблема, которую он решает. Если оттянуть страницу у верхнего края,
/// WebKit сдвигает вместе с содержимым и элементы `position: fixed` —
/// верхняя панель уезжает вниз, а над ней открывается пустая полоса.
/// В вебе это лечится `overscroll-behavior: none`, но в WKWebView жест
/// перехватывает нативный `UIScrollView` раньше, чем он доходит до
/// страницы, и CSS до него не достаёт. Проверено на устройстве: одного
/// CSS оказалось мало.
///
/// Прокрутку саму по себе не трогаем — выключается только пружина на
/// границах документа.
///
/// Класс используется и в `Base.lproj/Main.storyboard`, и напрямую из
/// `SceneDelegate`. Если когда-нибудь `npx cap add ios` переигрывается с
/// нуля, обе нативные правки нужно будет повторить.
class MainViewController: CAPBridgeViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.scrollView.bounces = false
        webView?.scrollView.alwaysBounceVertical = false
        webView?.scrollView.alwaysBounceHorizontal = false
        // Масштабирование страницы жестами тоже ни к чему: размер текста
        // меняется настройками чтения. Meta viewport это уже запрещает,
        // здесь — страховка на уровне вьюшки.
        webView?.scrollView.bouncesZoom = false
        webView?.scrollView.maximumZoomScale = 1.0
        webView?.scrollView.minimumZoomScale = 1.0

        // Убираем системную полосу над клавиатурой с кнопками перехода
        // между полями и галочкой «Готово». Саму клавиатуру, подсказки и
        // работу поля поиска это не меняет.
        disableKeyboardShortcutBar()
        DispatchQueue.main.async { [weak self] in
            self?.disableKeyboardShortcutBar()
        }
    }

    /// Тема приложения → оформление системных элементов (Quran Ing,
    /// 2026-10-04).
    ///
    /// Системная панель вкладок iOS 26 (`@capawesome/capacitor-tab-bar`)
    /// берёт материал и цвет невыбранных вкладок из `userInterfaceStyle`, то
    /// есть из темы СИСТЕМЫ. Тема приложения своя: тёмная «Аврора» на
    /// светлом iPhone дала бы светлую панель под тёмным экраном. Отдельного
    /// моста для темы нет, но приложение и так выставляет стиль статус-бара
    /// под свою тему (src/lib/nativeStatusBar.ts → плагин StatusBar →
    /// `bridge.statusBarStyle` → этот метод). Светлый текст статус-бара
    /// значит тёмную тему, тёмный — светлую.
    ///
    /// Заодно клавиатура в поле поиска следует теме приложения.
    /// `prefers-color-scheme` страница для темы не использует (только мета
    /// theme-color, которая в приложении ни на что не влияет).
    override func setStatusBarStyle(_ statusBarStyle: UIStatusBarStyle) {
        super.setStatusBarStyle(statusBarStyle)
        switch statusBarStyle {
        case .lightContent:
            overrideUserInterfaceStyle = .dark
        case .darkContent:
            overrideUserInterfaceStyle = .light
        default:
            overrideUserInterfaceStyle = .unspecified
        }
    }

    /// Плагины самого приложения (не из npm) регистрируются здесь —
    /// документированный путь Capacitor для локального нативного кода.
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(ThemeBackgroundPlugin())
    }

    private func disableKeyboardShortcutBar() {
        inputAssistantItem.leadingBarButtonGroups = []
        inputAssistantItem.trailingBarButtonGroups = []
        webView?.inputAssistantItem.leadingBarButtonGroups = []
        webView?.inputAssistantItem.trailingBarButtonGroups = []
    }
}

/// Фон веб-вью цветом темы приложения (Quran Ing, 2026-10-04).
///
/// `ios.backgroundColor` в capacitor.config.ts — тёмно-красный #440505
/// заставки, чтобы запуск был без вспышки. Но эффект края системной панели
/// вкладок iOS 26 растворяет контент в фон прокрутки веб-вью: под панелью
/// шла тёмно-красная полоса поверх списка сур (скриншот владельца, сборка 2).
/// После заставки JS присылает сюда точный цвет страницы темы (`--canvas`,
/// src/lib/themeBackground.ts) — у тем он разный (белый, бежевый, чёрный),
/// и по стилю статус-бара его не угадать.
@objc(ThemeBackgroundPlugin)
public class ThemeBackgroundPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ThemeBackgroundPlugin"
    public let jsName = "ThemeBackground"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setColor", returnType: CAPPluginReturnPromise)
    ]

    @objc func setColor(_ call: CAPPluginCall) {
        guard let hex = call.getString("color"), let color = ThemeBackgroundPlugin.color(fromHex: hex) else {
            call.reject("Ожидается цвет в виде #RRGGBB")
            return
        }
        DispatchQueue.main.async {
            self.bridge?.webView?.backgroundColor = color
            self.bridge?.webView?.scrollView.backgroundColor = color
            call.resolve()
        }
    }

    static func color(fromHex hex: String) -> UIColor? {
        var digits = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        guard digits.hasPrefix("#") else { return nil }
        digits.removeFirst()
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        return UIColor(
            red: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: 1
        )
    }
}
