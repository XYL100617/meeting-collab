import base64
import html
import json
import os
import re
import sys
import tempfile
from datetime import datetime
from io import BytesIO
from xml.etree import ElementTree as ET

payload = json.loads(sys.stdin.buffer.read().decode("utf-8-sig"))
fmt = payload.get("format", "docx")

def xml_safe_text(value):
    """Remove characters that are forbidden by XML 1.0 and WordprocessingML."""
    text = str(value if value is not None else "")
    return "".join(
        char for char in text
        if char in "\t\n\r"
        or 0x20 <= ord(char) <= 0xD7FF
        or 0xE000 <= ord(char) <= 0xFFFD
        or 0x10000 <= ord(char) <= 0x10FFFF
    )

title = xml_safe_text(payload.get("title", "项目记录"))
project = xml_safe_text(payload.get("project", "项目"))
body_html = xml_safe_text(payload.get("body", ""))
metadata = [
    (xml_safe_text(key), xml_safe_text(value))
    for key, value in payload.get("metadata", [])
]

def plain_from_html(source):
    from html.parser import HTMLParser
    class Text(HTMLParser):
        def __init__(self): super().__init__(); self.parts=[]
        def handle_data(self, data): self.parts.append(xml_safe_text(data))
        def handle_starttag(self, tag, attrs):
            if tag in ('p','div','br','li','tr','h1','h2','h3','blockquote'): self.parts.append('\n')
    parser=Text(); parser.feed(source or '')
    return '\n'.join(x.strip() for x in ''.join(parser.parts).splitlines() if x.strip())

def html_document():
    meta=''.join(f'<p class="meta"><b>{html.escape(str(k))}</b>　{html.escape(str(v))}</p>' for k,v in metadata)
    body=body_html or '<p></p>'
    return f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
    @page{{size:A4;margin:22mm 20mm}}body{{font-family:"Microsoft YaHei","Noto Sans CJK SC",sans-serif;color:#222;font-size:10.5pt;line-height:1.75}}
    h1{{font-size:21pt;margin:0 0 8pt}}.project{{color:#526b58;font-size:10pt}}.meta{{font-size:9pt;color:#555;margin:3pt 0}}
    hr{{border:0;border-top:1px solid #d9dfd9;margin:14pt 0}}table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #ccd5cd;padding:5pt}}
    img{{max-width:100%;height:auto}}blockquote{{border-left:3px solid #65836d;padding-left:10pt;color:#59635b}}a{{color:#315e4b}}
    </style><body><div class="project">{html.escape(project)}</div><h1>{html.escape(title)}</h1>{meta}<hr>{body}</body></html>'''

if fmt == 'docx':
    from docx import Document
    from docx.shared import Inches, Pt, RGBColor
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from html.parser import HTMLParser
    from docx.opc.constants import RELATIONSHIP_TYPE as REL
    doc=Document(); section=doc.sections[0]; section.top_margin=Inches(.72);section.bottom_margin=Inches(.72)
    normal=doc.styles['Normal'];normal.font.name='Microsoft YaHei';normal.font.size=Pt(10.5);normal._element.rPr.rFonts.set(qn('w:eastAsia'),'Microsoft YaHei')
    p=doc.add_paragraph(project);p.style='Subtitle'
    doc.add_heading(title,0)
    for k,v in metadata: doc.add_paragraph(xml_safe_text(f'{k}：{v}'))
    class DocxBody(HTMLParser):
        def __init__(self, document):
            super().__init__(convert_charrefs=True); self.doc=document; self.p=None; self.styles=[]; self.link=None; self.lists=[]; self.table=None; self.row=0; self.col=0; self.cell=None; self.inline=[]
        def para(self, style=None):
            if self.table is not None and self.cell is not None: return self.cell.paragraphs[0]
            self.p=self.doc.add_paragraph(style=style); return self.p
        def starttag(self, tag, attrs):
            attrs=dict(attrs)
            if tag=='table':
                self.p=None; self.table=self.doc.add_table(rows=1,cols=1); self.table.style='Table Grid'; self.row=0; self.col=0; return
            if tag=='tr' and self.table is not None:
                if self.row: self.table.add_row()
                self.col=0; self.cell=None; self.row+=1; return
            if tag in ('td','th') and self.table is not None:
                while len(self.table.columns)<=self.col: self.table.add_column(Inches(1.7))
                self.cell=self.table.rows[self.row-1].cells[self.col]; self.cell.text=''; self.col+=1
                return
            if tag in ('ul','ol'): self.lists.append('List Bullet' if tag=='ul' else 'List Number'); return
            if tag=='li': self.para(self.lists[-1] if self.lists else 'List Bullet'); return
            if tag in ('p','h1','h2','h3','blockquote'):
                style={'h1':'Heading 1','h2':'Heading 2','h3':'Heading 3','blockquote':'Quote'}.get(tag)
                self.para(style); return
            if tag=='br': self.para().add_run().add_break(); return
            if tag in ('strong','b','em','i','u','s'): self.styles.append(tag); return
            if tag=='span':
                style=dict(attrs).get('style',''); color=__import__('re').search(r'(?:^|;)\s*color\s*:\s*#([0-9a-f]{6})',style,re.I); bg=__import__('re').search(r'(?:^|;)\s*background-color\s*:\s*#([0-9a-f]{6})',style,re.I); self.inline.append((color.group(1) if color else None,bg.group(1) if bg else None)); return
            if tag=='a': self.link=attrs.get('href'); return
            if tag=='img':
                src=attrs.get('src','')
                if src.startswith('data:image/') and ';base64,' in src:
                    try:
                        image_data = base64.b64decode(
                            src.split(';base64,', 1)[1],
                            validate=True,
                        )
                        self.para().add_run().add_picture(
                            BytesIO(image_data),
                            width=Inches(5.8),
                        )
                    except Exception as exc:
                        raise RuntimeError(
                            f"正文图片无法写入 Word：{exc}"
                        ) from exc
        def handle_starttag(self, tag, attrs): self.starttag(tag,attrs)
        def handle_endtag(self, tag):
            if tag=='table': self.table=None; self.cell=None; self.p=None
            elif tag in ('td','th'): self.cell=None
            elif tag in ('ul','ol') and self.lists: self.lists.pop()
            elif tag in ('p','h1','h2','h3','li','blockquote'): self.p=None
            elif tag=='span' and self.inline: self.inline.pop()
            elif tag in ('strong','b','em','i','u','s') and tag in self.styles: self.styles.reverse();self.styles.remove(tag);self.styles.reverse()
            elif tag=='a': self.link=None
        def handle_data(self, data):
            data=xml_safe_text(data)
            if not data: return
            p=self.para()
            if self.link:
                rid=p.part.relate_to(self.link,REL.HYPERLINK,is_external=True);hyperlink=OxmlElement('w:hyperlink');hyperlink.set(qn('r:id'),rid);run=OxmlElement('w:r');props=OxmlElement('w:rPr');color=OxmlElement('w:color');color.set(qn('w:val'),'3158D9');props.append(color);under=OxmlElement('w:u');under.set(qn('w:val'),'single');props.append(under);run.append(props);node=OxmlElement('w:t');node.text=data;run.append(node);hyperlink.append(run);p._p.append(hyperlink);return
            r=p.add_run(data)
            r.bold=any(x in ('strong','b') for x in self.styles);r.italic=any(x in ('em','i') for x in self.styles);r.underline='u' in self.styles
            r.font.name='Microsoft YaHei';r._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),'Microsoft YaHei')
            if self.inline:
                color,bg=self.inline[-1]
                if color:
                    try:r.font.color.rgb=RGBColor.from_string(color.upper())
                    except ValueError:pass
                if bg:
                    try:
                        shade=OxmlElement('w:shd');shade.set(qn('w:fill'),bg.upper());r._element.get_or_add_rPr().append(shade)
                    except ValueError:pass
            if self.link:
                r.font.color.rgb=RGBColor(49,88,217);r.underline=True
    parser=DocxBody(doc);parser.feed(body_html or '<p></p>')
    out=BytesIO();doc.save(out);data=out.getvalue()
elif fmt == 'pdf':
    import fitz
    font_candidates=[
        os.path.join(os.environ.get('WINDIR',r'C:\Windows'),'Fonts','simhei.ttf'),
        os.path.join(os.environ.get('WINDIR',r'C:\Windows'),'Fonts','msyh.ttc'),
        os.path.join(os.environ.get('WINDIR',r'C:\Windows'),'Fonts','NotoSansSC-VF.ttf'),
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    ]
    cjk_font=next((candidate for candidate in font_candidates if os.path.isfile(candidate)),None)
    if not cjk_font:
        raise RuntimeError('找不到可用于 PDF 中文排版的 CJK 字体。')
    font_dir=os.path.dirname(cjk_font)
    font_file=os.path.basename(cjk_font)
    pdf_css=f'''@font-face {{ font-family: ProjectCJK; src: url("{font_file}"); }}
        body, h1, h2, h3, p, table, td, th, blockquote {{ font-family: ProjectCJK, sans-serif; }}'''
    story=fitz.Story(html=html_document(),user_css=pdf_css,archive=fitz.Archive(font_dir))
    fd,tmp_path=tempfile.mkstemp(suffix='.pdf');os.close(fd)
    doc=fitz.DocumentWriter(tmp_path)
    mediabox=fitz.paper_rect('a4')
    where=fitz.Rect(56,62,mediabox.width-56,mediabox.height-62)
    more=True
    while more:
        device=doc.begin_page(mediabox)
        more,filled=story.place(where)
        story.draw(device)
        doc.end_page()
    doc.close()
    del doc, story, device
    import gc;gc.collect()
    with open(tmp_path,'rb') as source: data=source.read()
    os.unlink(tmp_path)
else:
    raise ValueError('format must be docx or pdf')
sys.stdout.write(base64.b64encode(data).decode('ascii'))
