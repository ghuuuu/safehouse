# Tessdata

Models Tesseract loads from `--tessdata-dir`, vendored rather than fetched at
build time (D27). A build that depends on an archived repository staying online
is a build that fails one day.

## mrz.traineddata — not yet here

The OCR-B model for passport and ID-card strips. Until it is placed here, the
machine-readable path reports that it cannot read and nothing is filled in —
it never falls back to the English model, which gets 45% of MRZ characters
wrong and would propose confident nonsense.

Take it from Doubango's `tesseractMRZ` (BSD-3-Clause, archived January 2021):

    https://github.com/DoubangoTelecom/tesseractMRZ
    tessdata_best/mrz.traineddata  →  tessdata/mrz.traineddata

Check the licence file in that repository is still BSD-3-Clause before
shipping, and keep a copy of it next to the model.

Do not use `Shreeshrii/tessdata_ocrb`, which is the first search result for
this: it has no licence file at all, and no licence means no grant of rights.

The alternative, if a model with clearer provenance is wanted, is to train one
from freely-licensed OCR-B fonts and synthetic text. That gives a model whose
ownership is unambiguous, at the cost of an afternoon.
