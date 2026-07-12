# English Word Vault

Local app for storing English vocabulary in a JSON file database. The visible hierarchy is `Source -> Unit -> Topic`.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Maintenance

One JSON repair script is kept for emergency recovery of `data/national-test-pages.json`.

```bash
npm run repair:national-test-pages
```

The command above is a dry run. If it reports a valid repair candidate, write the repaired file with:

```bash
npm run repair:national-test-pages -- --write
```

The write mode creates a timestamped backup before replacing the JSON file.

## Data

Words are stored in `data/words.json`. Study texts are stored separately in `data/study-texts.json`. Study video metadata is stored separately in `data/study-videos.json`, and the video files are stored in `data/videos`. Uploaded word images are stored in `data/images`. Cached pronunciation MP3 files are stored in `data/pronunciations`.
Review scheduling is stored per word in `data/practice-progress.json`.
Pronunciation audio is fetched from Merriam-Webster when an API key is configured.

Each word uses this shape:

```json
{
  "word": "",
  "definition": "",
  "partOfSpeech": "",
  "collocations": [],
  "examples": [],
  "synonyms": [
    {
      "word": "",
      "comparison": ""
    }
  ]
}
```

The app also adds `id`, `sourceId`, `branchId`, `unitId`, `image`, `createdAt`, and `updatedAt`. Internally, `branchId` stores the selected Unit and `unitId` stores the selected Topic.

Study texts are saved as separate records in `data/study-texts.json` under `studyTexts`. Each text has `id`, `title`, `type`, `content`, `sourceId`, `branchId`, `unitId`, `createdAt`, and `updatedAt`, so it can be attached to a source, unit, or topic and edited independently from vocabulary words.

Study videos are saved as separate records in `data/study-videos.json` under `studyVideos`. Each video record has `id`, `title`, `type`, `sourceId`, `branchId`, `unitId`, `video`, `createdAt`, and `updatedAt`. The `video` object points to the actual saved file in `data/videos`.
The video recorder can save a normal camera recording, a blurred-background recording, or a recording with a selected background image.

Each practiced word also gets SRS state in `practice-progress.json`: `strengthLevel`, `mistakesCount`, `successfulReviews`, `lastReviewDate`, `intervalDays`, `easeFactor`, and `nextReviewDate`.

Pronunciation metadata is stored on each word as `pronunciation`. The app uses Merriam-Webster recorded audio, not browser text-to-speech. Configure a free non-commercial Merriam-Webster key with either the `MERRIAM_WEBSTER_API_KEY` environment variable or a local `data/merriam-webster-key.txt` file. The default reference is the Learner's Dictionary; set `MERRIAM_WEBSTER_REFERENCE` to use another Merriam-Webster reference. When a speaker button is used, the app downloads the MP3 once into `data/pronunciations` and reuses that local file for later practice.

The single-word form can also look up Merriam-Webster meanings. Type a word, choose `Look up`, select the exact meaning, then review/edit the filled definition, part of speech, examples, collocations, and synonyms before saving.

`partOfSpeech` is read from imported JSON and shown next to the word. It can be a string such as `"verb"` or an array such as `["noun", "verb"]`.

`synonyms` accepts simple strings or objects with `word` and `comparison`.

The JSON import tab accepts either one object or an array of objects. After pasting JSON, build the image boxes and click, drop, or paste an image into the box for the matching word.

When a saved/imported word has the same text as an existing word, the old record is replaced by the new one.

## National Test Page Import

National test pages can store both the extracted text and the visual page layout. Keep `pageLayout` when you want colors, shapes, lines, circles, images, and positioned text to be rendered in the app. Study-only fields such as tasks, notes, and confidence are not part of the page model.

```json
{
  "pages": [
    {
      "pageNumber": 1,
      "text": "Full extracted text of the page.",
      "pageLayout": {
        "pageSize": { "width": 768, "height": 1024, "unit": "px" },
        "elements": [
          {
            "id": "title",
            "type": "text",
            "x": 40,
            "y": 40,
            "width": 640,
            "height": 40,
            "text": "A Sustainable Society",
            "style": {
              "fontSize": 24,
              "fontWeight": "bold",
              "color": "#222222",
              "lineHeight": 1.2
            }
          },
          {
            "id": "shape1",
            "type": "rectangle",
            "x": 60,
            "y": 140,
            "width": 220,
            "height": 120,
            "style": {
              "backgroundColor": "#d8df6a"
            }
          },
          {
            "id": "line1",
            "type": "line",
            "x": 40,
            "y": 100,
            "width": 640,
            "height": 2,
            "style": {
              "strokeColor": "#999999",
              "strokeWidth": 1
            }
          }
        ]
      },
      "words": [
        "sustainable",
        { "word": "society", "note": "community" }
      ]
    }
  ]
}
```

`text`, `extractedText`, or `content` are accepted as the extracted page text. `pageLayout` is optional but should be included when you want visual extraction. `title` and `section` are still accepted as optional metadata.
