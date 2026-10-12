export function languageLabel(language: string) {
  return {
    vi: "Tiếng Việt",
    en: "English",
    auto: "Tự nhận diện Việt / Anh",
  }[language] ?? language.toUpperCase();
}
