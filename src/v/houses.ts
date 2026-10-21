// As sete casas. Só o que se sabe delas; nada inventado.

export type House = {
  id: string
  name: string
  kind: string // cozinha, em poucas palavras
  where: string
  shape: 'block' | 'pebble' | 'pane' | 'dome' | 'crystal' | 'disc' | 'arch'
  engrave: { img?: string; text?: string; crop?: [number, number, number, number] }
  photo?: string
  text: string
  maps: string
}

const q = (s: string) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s)

export const HOUSES: House[] = [
  {
    id: 'iz',
    name: 'Íz',
    kind: 'Contemporânea',
    where: 'Setor Marista',
    shape: 'block',
    engrave: { img: 'iz_rest', crop: [0.14, 0.0, 0.86, 1.0] },
    photo: 'iz_unnamed',
    text: 'A primeira casa. Ian Baiocchi cozinhou no D.O.M., no Maní, no El Celler de Can Roca e no Mugaritz, voltou para Goiânia e abriu o Íz em 2015. Em 2016, Domingos Ávila, amigo da academia de karatê da família, virou sócio. Alta gastronomia com alma regional.',
    maps: q('Íz restaurante Goiânia'),
  },
  {
    id: '1929',
    name: '1929 Trattoria',
    kind: 'Italiana',
    where: 'Goiânia',
    shape: 'pebble',
    engrave: { img: 't1929' },
    photo: 't1929',
    text: 'Cozinha de trattoria. O nome é o ano da avó, Dona Colombina.',
    maps: q('1929 Trattoria Goiânia'),
  },
  {
    id: 'gra',
    name: 'Grá',
    kind: 'Bistrô francês',
    where: '192 m acima de Goiânia',
    shape: 'pane',
    engrave: { img: 'gra2' },
    photo: 'gra1',
    text: 'Um bistrô francês no alto da cidade: 192 metros acima de Goiânia, com a cidade inteira do lado de fora da janela.',
    maps: q('Grá bistrô Goiânia'),
  },
  {
    id: 'alata',
    name: 'Alata',
    kind: 'Sorvete artesanal',
    where: 'Goiânia',
    shape: 'dome',
    engrave: { img: 'sorvete' },
    photo: 'sorvete',
    text: 'Sorvete artesanal, feito pela mesma régua das outras casas.',
    maps: q('Alata sorvete Goiânia'),
  },
  {
    id: 'fulles',
    name: 'Fulles Kitchen',
    kind: 'Cozinha na lenha',
    where: 'Goiânia',
    shape: 'crystal',
    engrave: { text: 'Fulles' },
    text: 'Cozinha na lenha.',
    maps: q('Fulles Kitchen Goiânia'),
  },
  {
    id: 'hotel',
    name: 'Íz Hotel',
    kind: 'Restaurant with rooms',
    where: 'Setor Marista',
    shape: 'disc',
    engrave: { img: 'iz_9' },
    photo: 'iz_9',
    text: 'Restaurant with rooms: três suítes junto do Íz.',
    maps: q('Íz Hotel Goiânia'),
  },
  {
    id: 'nip',
    name: 'nip',
    kind: 'Not in Napoli',
    where: 'Rua 1130',
    shape: 'arch',
    engrave: { img: 'nip_pizza', crop: [0.0, 0.12, 1.0, 0.8] },
    photo: 'nip_pizza',
    text: 'Not in Napoli. A pizzaria ao lado do Íz, na Rua 1130, aberta em abril de 2026.',
    maps: q('nip Not in Napoli Goiânia'),
  },
]
