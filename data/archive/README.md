# Архив research trace PH V5–V9

`ph-v5-v9-model-sweep-inner.jsonl.zip` хранит точную копию большого JSONL trace из commit `0fbeb7bf56d0d7b871562dcf1ca85a77cf510de4`.

- исходный путь: `data/eval/ph-v5-v9-model-sweep-inner.jsonl`;
- исходный размер: `154589305` байт;
- исходный SHA-256: `990ff3754d9560339233a50e44002a5358456a4c3114c52709f263d0ee0b4b99`;
- ZIP SHA-256: `2255aa6195cbd8d12a706c65f58fdb2e3036149af5bddcf4be40322c25a12fb2`.

Архив не является runtime-зависимостью Capture site. Для старых research verification-команд файл нужно распаковать обратно в исходный путь:

```powershell
Expand-Archive -LiteralPath data\archive\ph-v5-v9-model-sweep-inner.jsonl.zip -DestinationPath data\eval
```
