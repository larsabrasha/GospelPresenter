# Makes deck.pptx, the PowerPoint deck gp-pptx's tests and the e2e import read (python-pptx 1.0):
#   python3 crates/gp-pptx/fixtures/make_deck.py
# Slide 1: a title and a list of three points built by paragraph, one a click, as PowerPoint writes "Appear, by
# paragraph" (p:timing, added as XML: python-pptx writes no animations). Slide 2: hidden, so not shown. Slide 3: a
# column chart, which DeckCraft draws otherwise than PowerPoint.
from pathlib import Path

from lxml import etree
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches

P = 'http://schemas.openxmlformats.org/presentationml/2006/main'


def appear_by_paragraph(spid, paragraphs):
    """The timing PowerPoint writes for "Appear" on shape `spid`, a paragraph a click."""
    ids = iter(range(3, 1000))
    clicks = ''
    for k in range(paragraphs):
        a, b, c, d = next(ids), next(ids), next(ids), next(ids)
        clicks += f'''
<p:par><p:cTn id="{a}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>
 <p:par><p:cTn id="{b}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>
  <p:par><p:cTn id="{c}" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect">
   <p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>
    <p:set><p:cBhvr><p:cTn id="{d}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>
     <p:tgtEl><p:spTgt spid="{spid}"><p:txEl><p:pRg st="{k}" end="{k}"/></p:txEl></p:spTgt></p:tgtEl>
     <p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>
     <p:to><p:strVal val="visible"/></p:to></p:set>
   </p:childTnLst></p:cTn></p:par>
 </p:childTnLst></p:cTn></p:par>
</p:childTnLst></p:cTn></p:par>'''
    return etree.fromstring(f'''<p:timing xmlns:p="{P}"><p:tnLst><p:par>
<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>
<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>{clicks}
</p:childTnLst></p:cTn>
<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>
<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>
</p:childTnLst></p:cTn></p:par></p:tnLst>
<p:bldLst><p:bldP spid="{spid}" grpId="0" build="p"/></p:bldLst></p:timing>''')


deck = Presentation()
deck.slide_width, deck.slide_height = Inches(13.333), Inches(7.5)

built = deck.slides.add_slide(deck.slide_layouts[1])
built.shapes.title.text = 'Predikan'
body = built.placeholders[1]
body.text_frame.text = 'Nåd'
for point in ['Tro', 'Hopp']:
    body.text_frame.add_paragraph().text = point
built._element.append(appear_by_paragraph(body.shape_id, 3))

hidden = deck.slides.add_slide(deck.slide_layouts[5])
hidden.shapes.title.text = 'Dold'
hidden._element.set('show', '0')

charted = deck.slides.add_slide(deck.slide_layouts[5])
charted.shapes.title.text = 'Kollekt'
data = CategoryChartData()
data.categories = ['Jan', 'Feb', 'Mar']
data.add_series('Kronor', (1200, 1500, 900))
charted.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1), Inches(1.5), Inches(11), Inches(5.5), data)

deck.save(Path(__file__).with_name('deck.pptx'))
