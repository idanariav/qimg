// SmolVLM-256M caption generation via low-level transformers.js API.
// We bypass the image-to-text pipeline because it doesn't support the chat
// template required by instruction-tuned VLMs like SmolVLM.

const MODEL = "HuggingFaceTB/SmolVLM-256M-Instruct";
const PROMPT = "Describe this image concisely in one or two sentences.";

let componentPromise: Promise<{ processor: any; tokenizer: any; model: any; tf: any }> | null = null;

function getComponents() {
  if (!componentPromise) {
    componentPromise = (async () => {
      const tf = await import("@huggingface/transformers");
      const [processor, tokenizer, model] = await Promise.all([
        tf.AutoProcessor.from_pretrained(MODEL),
        tf.AutoTokenizer.from_pretrained(MODEL),
        (tf as any).AutoModelForVision2Seq.from_pretrained(MODEL),
      ]);
      return { processor, tokenizer, model, tf };
    })();
  }
  return componentPromise!;
}

export async function generateCaption(imagePath: string): Promise<string> {
  const { processor, tokenizer, model, tf } = await getComponents();

  const messages = [
    {
      role: "user",
      content: [
        { type: "image" },
        { type: "text", text: PROMPT },
      ],
    },
  ];

  const text = tokenizer.apply_chat_template(messages, {
    tokenize: false,
    add_generation_prompt: true,
  });

  const image = await tf.RawImage.read(imagePath);
  const inputs = await processor(text, image);
  const inputLength: number = inputs.input_ids.dims[1];

  const outputIds = await model.generate({ ...inputs, max_new_tokens: 150 });

  // Trim input tokens from output — decode only the generated portion
  const rows: number[][] = outputIds.tolist();
  const newTokens = rows.map((row) => row.slice(inputLength));
  const decoded: string[] = tokenizer.batch_decode(newTokens, { skip_special_tokens: true });
  return (decoded[0] ?? "").trim();
}
