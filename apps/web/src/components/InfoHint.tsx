type InfoHintProps = {
  text: string;
};

type FieldCaptionProps = {
  children: string;
  hint: string;
};

/**
 * Маленькая подсказка для операторского интерфейса.
 *
 * Что делает:
 * - показывает привычную букву `i` рядом с названием поля;
 * - раскрывает короткое объяснение при наведении мышью или фокусе с клавиатуры;
 * - не требует отдельного состояния в форме, поэтому подходит для множества полей.
 */
export function InfoHint({ text }: InfoHintProps) {
  return (
    <span className="info-hint" tabIndex={0} aria-label={text} data-tip={text}>
      i
    </span>
  );
}

/**
 * Единая подпись поля: название + подсказка.
 *
 * Почему отдельный компонент:
 * - в Capture и Playground много служебных терминов;
 * - заказчику нужны русские объяснения рядом с каждым полем;
 * - одинаковая разметка держит форму плотной и предсказуемой.
 */
export function FieldCaption({ children, hint }: FieldCaptionProps) {
  return (
    <span className="field-caption">
      <span>{children}</span>
      <InfoHint text={hint} />
    </span>
  );
}
