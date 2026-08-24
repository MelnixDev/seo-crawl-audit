import type { Issue } from "./types.js";

export type ReportLocale = "en" | "uk";

export interface LocalizedIssueText {
  rule: string;
  message: string;
  remediation: string;
}

function englishRuleLabel(ruleId: string): string {
  const text = ruleId.replaceAll("-", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const UK_RULE_LABELS: Readonly<Record<string, string>> = {
  "page-unreachable": "Недоступна сторінка",
  "http-error": "HTTP-помилка",
  noindex: "Noindex",
  "x-robots-noindex": "Noindex у X-Robots-Tag",
  "robots-blocked": "Заблоковано robots.txt",
  "missing-canonical": "Відсутній canonical",
  "invalid-canonical": "Некоректний canonical",
  "cross-domain-canonical": "Canonical на іншому домені",
  "canonical-target-error": "Помилка цілі canonical",
  "redirect-loop": "Цикл перенаправлень",
  "long-redirect-chain": "Довгий ланцюжок перенаправлень",
  "sitemap-unavailable": "Sitemap недоступний",
  "noindex-in-sitemap": "Noindex у sitemap",
  "redirect-in-sitemap": "Перенаправлення у sitemap",
  "missing-title": "Відсутній title",
  "duplicate-title": "Дубльований title",
  "title-length": "Довжина title",
  "missing-description": "Відсутній description",
  "duplicate-description": "Дубльований description",
  "description-length": "Довжина description",
  "missing-h1": "Відсутній H1",
  "broken-internal-link": "Неробоче внутрішнє посилання",
  "orphan-sitemap-page": "Ізольована сторінка sitemap",
  "crawlable-not-in-sitemap": "Сторінка відсутня у sitemap",
  "invalid-hreflang": "Некоректний hreflang",
  "malformed-json-ld": "Некоректний JSON-LD",
  "http-on-https-site": "HTTP URL на HTTPS-сайті",
  "invalid-language": "Некоректне оголошення мови",
  "duplicate-content": "Дубльований контент",
  "multiple-h1": "Кілька H1",
  "missing-open-graph": "Неповні Open Graph metadata",
  "missing-twitter-metadata": "Неповні Twitter metadata",
  "image-missing-alt": "Зображення без alt",
  "low-word-count": "Мало тексту",
  "robots-changed": "robots.txt змінено",
  "page-missing": "Сторінку не перевірено",
  "status-regression": "Регресія HTTP-статусу",
  "new-noindex": "Новий noindex",
  "title-removed": "Title видалено",
  "title-changed": "Title змінено",
  "description-removed": "Description видалено",
  "canonical-removed": "Canonical видалено",
  "canonical-changed": "Canonical змінено",
  "h1-removed": "H1 видалено",
  "redirect-changed": "Перенаправлення змінено",
  "sitemap-url-count-drop": "Зменшення URL у sitemap",
};

const UK_REMEDIATIONS: Readonly<Record<string, string>> = {
  "page-unreachable": "Відновіть сторінку або приберіть посилання на неї.",
  "http-error": "Поверніть успішну відповідь або свідоме перенаправлення.",
  noindex: "Приберіть noindex, якщо сторінка має з’являтися в пошуку.",
  "x-robots-noindex": "Приберіть noindex із X-Robots-Tag, якщо сторінка має індексуватися.",
  "robots-blocked": "Дозвольте URL у robots.txt, якщо його потрібно сканувати.",
  "missing-canonical": "Вкажіть бажаний canonical URL, якщо можливі дублікати адреси.",
  "invalid-canonical": "Використайте абсолютний або коректний відносний HTTP(S) canonical URL.",
  "cross-domain-canonical": "Підтвердьте зовнішній canonical або вкажіть потрібний URL цього сайту.",
  "canonical-target-error": "Спрямуйте canonical на доступний URL, дозволений для індексації.",
  "redirect-loop": "Приберіть циклічний маршрут перенаправлень.",
  "long-redirect-chain": "Перенаправляйте одразу на кінцеву адресу.",
  "sitemap-unavailable": "Відновіть коректний і доступний XML sitemap.",
  "noindex-in-sitemap": "Приберіть URL із sitemap або дозвольте його індексацію.",
  "redirect-in-sitemap": "Замініть URL у sitemap на його кінцеву canonical-адресу.",
  "missing-title": "Додайте унікальний описовий HTML title.",
  "duplicate-title": "Напишіть title, який унікально описує цю сторінку.",
  "title-length": "Зробіть title стислим і змістовним, зазвичай 10–60 символів.",
  "missing-description": "Додайте корисний meta description.",
  "duplicate-description": "Напишіть унікальний meta description для цієї сторінки.",
  "description-length": "Зробіть description корисним і зазвичай довжиною 50–160 символів.",
  "missing-h1": "Додайте один зрозумілий основний заголовок.",
  "broken-internal-link": "Оновіть або приберіть внутрішнє посилання чи відновіть його ціль.",
  "orphan-sitemap-page": "Додайте змістовні внутрішні посилання на сторінку із sitemap.",
  "crawlable-not-in-sitemap": "Додайте сторінку до sitemap або свідомо виключіть її.",
  "invalid-hreflang": "Використайте коректні мовні теги та доступні HTTP(S) alternate URL.",
  "malformed-json-ld": "Виправте JSON-синтаксис у блоці структурованих даних.",
  "http-on-https-site": "Використовуйте HTTPS для внутрішніх URL і metadata.",
  "invalid-language": "Вкажіть коректний мовний тег BCP 47 в елементі html.",
  "duplicate-content": "Об’єднайте дубльовані сторінки або зробіть їхній основний контент відмінним.",
  "multiple-h1": "Перевірте, чи один основний H1 не зробить ієрархію зрозумілішою.",
  "missing-open-graph": "Додайте Open Graph title, description та image для поширення в соцмережах.",
  "missing-twitter-metadata": "Додайте Twitter card metadata, якщо важливі соціальні прев’ю.",
  "image-missing-alt": "Додайте змістовний alt або порожній alt для декоративних зображень.",
  "low-word-count": "Перевірте, чи сторінка містить достатньо корисного основного контенту.",
  "robots-changed": "Перевірте зміну robots.txt і підтвердьте, що доступ для сканування змінено свідомо.",
  "page-missing": "Додайте сторінку до перевірки або підтвердьте, що її видалено свідомо.",
  "status-regression": "Відновіть попередню успішну HTTP-відповідь.",
  "new-noindex": "Приберіть новий noindex, якщо його не додано навмисно.",
  "title-removed": "Відновіть змістовний title.",
  "title-changed": "Перевірте та підтвердьте змінений title.",
  "description-removed": "Відновіть корисний meta description.",
  "canonical-removed": "Відновіть canonical.",
  "canonical-changed": "Підтвердьте, що нова ціль canonical свідома й коректна.",
  "h1-removed": "Відновіть зрозумілий основний заголовок.",
  "redirect-changed": "Підтвердьте, що нова ціль перенаправлення свідома.",
  "sitemap-url-count-drop": "Дослідіть втрату URL у sitemap і поверніть пропущені сторінки для індексації.",
};

function actual(issue: Partial<Issue>): unknown {
  return issue.evidence?.actual ?? issue.after;
}

function ukrainianMessage(issue: Partial<Issue>, ruleId: string): string {
  const value = actual(issue);
  switch (ruleId) {
    case "page-unreachable":
    case "redirect-loop": return `Запит сторінки завершився помилкою: ${String(value ?? "невідома помилка")}`;
    case "http-error": return `Сторінка повернула HTTP ${String(value ?? "невідомо")}`;
    case "noindex": return "Сторінка містить директиву noindex у meta";
    case "x-robots-noindex": return "Сторінка містить noindex у X-Robots-Tag";
    case "robots-blocked": return issue.before === false ? "Тепер сторінку заблоковано через robots.txt" : "Сторінку заблоковано через robots.txt";
    case "missing-canonical": return "Сторінка не містить canonical URL";
    case "invalid-canonical": return "Canonical URL некоректний";
    case "cross-domain-canonical": return "Canonical вказує на інший домен";
    case "canonical-target-error": return "Ціль canonical недоступна";
    case "long-redirect-chain": return `Сторінка використовує ${String(value ?? 0)} перенаправлень`;
    case "sitemap-unavailable": return "Не вдалося завантажити налаштований sitemap";
    case "noindex-in-sitemap": return "URL із sitemap позначений noindex";
    case "redirect-in-sitemap": return "URL із sitemap перенаправляється";
    case "missing-title": return "Сторінка не має title";
    case "duplicate-title": return "Кілька сторінок мають однаковий title";
    case "title-length": return `Довжина title — ${String(value ?? 0)} символів`;
    case "missing-description": return "Сторінка не має meta description";
    case "duplicate-description": return "Кілька сторінок мають однаковий meta description";
    case "description-length": return `Довжина description — ${String(value ?? 0)} символів`;
    case "missing-h1": return "Сторінка не містить заголовка H1";
    case "multiple-h1": return `Сторінка містить H1 у кількості: ${String(value ?? 0)}`;
    case "broken-internal-link": return "Внутрішнє посилання веде на недоступну сторінку";
    case "orphan-sitemap-page": return "На сторінку із sitemap не знайдено внутрішніх посилань";
    case "crawlable-not-in-sitemap": return "Доступна для сканування сторінка відсутня у sitemap";
    case "invalid-hreflang": return "Оголошення hreflang некоректне";
    case "malformed-json-ld": return "Блок JSON-LD містить некоректний JSON";
    case "http-on-https-site": return "HTTPS-сайт посилається на внутрішній HTTP URL";
    case "invalid-language": return "Оголошення мови HTML некоректне";
    case "duplicate-content": return "Основний текст є точним дублем іншої сторінки";
    case "missing-open-graph": return "Open Graph metadata неповні";
    case "missing-twitter-metadata": return "Twitter card metadata неповні";
    case "image-missing-alt": return `${Array.isArray(value) ? value.length : String(value ?? 0)} зображень не мають атрибута alt`;
    case "low-word-count": return `Сторінка містить приблизно ${String(value ?? 0)} видимих слів`;
    case "robots-changed": return "Вміст robots.txt змінився";
    case "page-missing": return "Сторінку не було перевірено";
    case "status-regression": return `HTTP-статус погіршився з ${String(issue.before ?? "невідомо")} до ${String(issue.after ?? "відсутній")}`;
    case "new-noindex": return "Тепер сторінка містить директиву noindex";
    case "title-removed": return "Title сторінки видалено";
    case "title-changed": return "Title сторінки змінено";
    case "description-removed": return "Meta description видалено";
    case "canonical-removed": return "Canonical URL видалено";
    case "canonical-changed": return "Canonical URL змінено";
    case "h1-removed": return "Усі заголовки H1 видалено";
    case "redirect-changed": return "Кінцевий URL перенаправлення змінено";
    case "sitemap-url-count-drop": return `Кількість URL у sitemap зменшилася на ${String((Number(issue.before) || 0) - (Number(issue.after) || 0))}`;
    default: return issue.message ?? "Перевірте проблему та підтвердьте очікувану поведінку.";
  }
}

export function localizeIssue(issue: Partial<Issue>, ruleId: string): Record<ReportLocale, LocalizedIssueText> {
  const englishRemediation = issue.remediation ?? "Review the finding and confirm the intended behavior.";
  return {
    en: {
      rule: englishRuleLabel(ruleId),
      message: issue.message ?? "",
      remediation: englishRemediation,
    },
    uk: {
      rule: UK_RULE_LABELS[ruleId] ?? englishRuleLabel(ruleId),
      message: ukrainianMessage(issue, ruleId),
      remediation: UK_REMEDIATIONS[ruleId] ?? "Перевірте проблему та підтвердьте очікувану поведінку.",
    },
  };
}

export const REPORT_COPY = {
  en: {
    language: "Language",
    titles: { partial: "Partial SEO scan report", check: "SEO regression report", scan: "SEO baseline audit" },
    generated: "Generated",
    engine: "Engine",
    rules: "Rules",
    issueLifecycle: "Issue lifecycle",
    partialTitle: "Partial results.",
    partialMessage: "This report contains the pages saved so far. Run the same scan command again to resume without requesting them twice.",
    incompleteTitle: "Incomplete comparison.",
    incompleteMessage: "Regressions found on checked pages are shown, but unchecked pages are not marked missing or resolved.",
    cards: { pages: "Pages checked", error: "Errors", warning: "Warnings", info: "Info", affected: "Affected pages" },
    analytics: {
      title: "Issue statistics",
      hint: "Select a chart item to filter the issue table.",
      severity: "By severity",
      topRules: "Most frequent checks",
      owners: "By owner",
      lifecycle: "By lifecycle",
      total: "Total issues",
      noData: "No issues to chart.",
      filterBy: "Filter by",
    },
    tabs: { current: "Current / all", new: "New", ongoing: "Ongoing", resolved: "Resolved", unchanged: "Unchanged" },
    filters: { search: "URL or text", searchPlaceholder: "URL, check, or message", severity: "Severity", rule: "Check", owner: "Owner", rows: "Rows" },
    all: { severity: "All severities", rule: "All checks", owner: "All owners" },
    severities: { error: "Error", warning: "Warning", info: "Info" },
    owners: { seo: "SEO", content: "Content", developer: "Developer" },
    rows: { 100: "100 per page", 250: "250 per page", 500: "500 per page" },
    guide: { error: "Errors", errorText: "need attention first.", warning: "Warnings", warningText: "are important improvements.", info: "Info", infoText: "is useful context.", score: "No opaque SEO score is used." },
    exportCsv: "Export CSV",
    previous: "Previous",
    next: "Next",
    table: { severity: "Severity", lifecycle: "Lifecycle", ruleOwner: "Check / owner", page: "Page", finding: "What was found", change: "Change", before: "Before", evidence: "Evidence / after", remediation: "Remediation", fingerprint: "Fingerprint" },
    empty: { cleanTitle: "No SEO issues found", cleanMessage: "The scanned pages passed all current checks.", filteredTitle: "No matching issues", filteredMessage: "Try a different lifecycle tab or clear the selected filters.", clear: "Clear filters" },
    lifecycle: { current: "Current", new: "New", ongoing: "Ongoing", resolved: "Resolved", unchanged: "Unchanged" },
    notPresent: "Not present",
    page: "Page",
    of: "of",
    issue: "issue",
    issues: "issues",
    docs: "docs",
    footer: "Generated locally. No report data was uploaded.",
  },
  uk: {
    language: "Мова",
    titles: { partial: "Звіт часткового SEO-сканування", check: "Звіт про SEO-регресії", scan: "Базовий SEO-аудит" },
    generated: "Створено",
    engine: "Рушій",
    rules: "Правила",
    issueLifecycle: "Стани проблем",
    partialTitle: "Часткові результати.",
    partialMessage: "Звіт містить уже збережені сторінки. Запустіть ту саму команду ще раз, щоб продовжити без повторних запитів.",
    incompleteTitle: "Неповне порівняння.",
    incompleteMessage: "Показано регресії на перевірених сторінках, але неперевірені сторінки не позначено як відсутні чи виправлені.",
    cards: { pages: "Перевірено сторінок", error: "Помилки", warning: "Попередження", info: "Інформація", affected: "Сторінки з проблемами" },
    analytics: {
      title: "Статистика проблем",
      hint: "Оберіть елемент графіка, щоб відфільтрувати таблицю проблем.",
      severity: "За важливістю",
      topRules: "Найчастіші перевірки",
      owners: "За відповідальними",
      lifecycle: "За станом",
      total: "Усього проблем",
      noData: "Немає проблем для відображення.",
      filterBy: "Фільтрувати за",
    },
    tabs: { current: "Поточні / усі", new: "Нові", ongoing: "Тривають", resolved: "Виправлені", unchanged: "Без змін" },
    filters: { search: "URL або текст", searchPlaceholder: "URL, перевірка або повідомлення", severity: "Важливість", rule: "Перевірка", owner: "Відповідальний", rows: "Рядки" },
    all: { severity: "Усі рівні", rule: "Усі перевірки", owner: "Усі відповідальні" },
    severities: { error: "Помилка", warning: "Попередження", info: "Інформація" },
    owners: { seo: "SEO", content: "Контент", developer: "Розробник" },
    rows: { 100: "100 на сторінку", 250: "250 на сторінку", 500: "500 на сторінку" },
    guide: { error: "Помилки", errorText: "потребують першочергової уваги.", warning: "Попередження", warningText: "позначають важливі покращення.", info: "Інформація", infoText: "дає корисний контекст.", score: "Непрозора SEO-оцінка не використовується." },
    exportCsv: "Експорт CSV",
    previous: "Назад",
    next: "Далі",
    table: { severity: "Важливість", lifecycle: "Стан", ruleOwner: "Перевірка / відповідальний", page: "Сторінка", finding: "Що знайдено", change: "Зміна", before: "Було", evidence: "Доказ / стало", remediation: "Як виправити", fingerprint: "Відбиток" },
    empty: { cleanTitle: "SEO-проблем не знайдено", cleanMessage: "Перевірені сторінки пройшли всі активні перевірки.", filteredTitle: "Збігів не знайдено", filteredMessage: "Оберіть інший стан або очистьте фільтри.", clear: "Очистити фільтри" },
    lifecycle: { current: "Поточна", new: "Нова", ongoing: "Триває", resolved: "Виправлена", unchanged: "Без змін" },
    notPresent: "Відсутнє",
    page: "Сторінка",
    of: "з",
    issue: "проблема",
    issues: "проблем",
    docs: "довідка",
    footer: "Створено локально. Дані звіту нікуди не завантажувалися.",
  },
} as const;
