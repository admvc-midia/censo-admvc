# Censo da Família ADMVC

> Cada família conta.

QR code no telão → o irmão escreve o telemóvel → preenche a família → a equipa vê tudo por bairro.

| Endereço | Para quê |
|---|---|
| `/` | O censo: telemóvel primeiro, depois o cadastro |
| `/telao` | Para projetar: QR code grande + contagem ao vivo |
| `/admin` | Painel da equipa (senha): famílias, filtros por bairro, CSV, lista de bairros |

## Como funciona

1. **Telemóvel.** Portugal (+351, 9 dígitos começando por 9), Brasil, Angola, Cabo Verde ou outro indicativo. O servidor diz em que caso estamos:

| Caso | O que acontece |
|---|---|
| Número novo | Cadastro vazio; quem preenche fica **Titular** de uma família nova |
| No pré-cadastro **com** data de nascimento | Pede a data. Confere → "Olá, Maria!" e formulário já preenchido com o que a equipa tinha. Não confere → pode tentar de novo ou **continuar com o formulário vazio**; a equipa vê o aviso "data diferente do pré-cadastro" |
| No pré-cadastro **sem** data | Só o primeiro nome ("Olá, Maria!"), formulário vazio |
| Já está no censo (titular, cônjuge ou filho com telemóvel) | "Olá, Mar\*\*\*" + data de nascimento **dessa pessoa** para abrir |

   Sem bloqueio por datas erradas: no pré-cadastro, ao 3.º erro o botão passa a "Continuar assim mesmo"; para quem já está no censo, aparece o contacto da mídia.

2. **A família.** Cada pessoa da casa é um registo próprio, ligado à família com um parentesco (Titular, Cônjuge, Filho(a), Outro) — o mesmo modelo do admvc-site (`Familia` + `familia_id` + `parentesco`).
   - **Titular e cônjuge** editam a família inteira (morada, pessoas, culto no lar).
   - **Um filho com telemóvel próprio** entra com o número dele e a data de nascimento que o pai escreveu, e edita **só os seus dados**; vê a morada e os nomes da família, sem mexer.
   - Para cada cônjuge e filho pede-se nome e data de nascimento; sexo, tipo e telemóvel são opcionais.
   - **Ligar quem já tem cadastro** (o filho cadastrou-se sozinho antes): o pai põe o telemóvel dele, e só funciona se acertar a data de nascimento do filho. Sem isso, qualquer um "adotava" o número de outra pessoa e via os dados dela.
   - Tirar da família alguém **com** telemóvel deixa-o numa família só dele (o cadastro não se perde); **sem** telemóvel, é apagado.

3. **Onde moram:** só **Endereço completo** (opcional, um campo) e **Bairro** (lista + "Outro", o único obrigatório). Se o endereço tiver um código postal no meio, é guardado à parte e usado para pôr a família no mapa. Moradas da planilha com colunas separadas (número, CP, localidade) são juntadas num endereço só.
4. **Se a gravação falhar, a tela diz que falhou.** Nunca há "obrigado" sem o registo estar na base. A família grava numa transação: ou entra tudo, ou nada.

## Pré-cadastro

Em `/admin → Pré-cadastro`, a equipa cola do Excel ou envia um CSV. Modelo em [modelo-pre-cadastro.csv](modelo-pre-cadastro.csv) (também no botão "Modelo da planilha").

| Coluna | Obrigatória | Notas |
|---|---|---|
| Nome completo | sim | |
| Telemóvel | sim | Com `+indicativo`. Sem `+` só passa número PT de 9 dígitos ou BR com DDD |
| Data de nascimento | recomendada | `12/04/1985`, `12-04-85` ou `1985-04-12` (dia primeiro). É o que permite pré-preencher com segurança |
| Morada, Número, Código postal, Localidade, Bairro | não | Vão para o formulário depois de a data conferir |
| E-mail, Sexo (M/F), Nacionalidade, Tipo | não | Idem |
| Observações | não | Só a equipa vê |
| Qualquer outra coluna | — | Fica nas observações como "Título: valor" |

Também aceita o CSV exportado do admvc-site. Importar de novo atualiza quem já está na lista. O painel mostra quem já respondeu (inclusive como cônjuge ou filho noutra família) e quem falta, com "Lembrar no WhatsApp".

**Segurança:** antes de a data conferir, nada do pré-cadastro sai do servidor (com data, nem o primeiro nome). As observações nunca saem. A data de nascimento não é um segredo forte — quem souber o número **e** a data de alguém vê a morada dessa pessoa; para a igreja, foi o nível aceite.

## Painel

- **Pré-cadastro → montar famílias:** marca as pessoas da mesma casa (☐) e carrega em **Criar família** (ou **Juntar a uma família** já existente). Escolhe o parentesco de cada um, a morada (vem da linha de quem escolheres) e acrescenta filhos sem telemóvel. Quem tem telemóvel precisa de data de nascimento; filhos sem telemóvel podem ficar sem data (o titular completa). Uma família montada pela equipa fica com **"Consentimento por confirmar"** até o titular ou o cônjuge entrar e marcar a caixa.
- **Editar** uma linha do pré-cadastro sem reimportar a planilha.
- **Famílias → Editar** uma pessoa (nome, data, telemóvel, parentesco — escolher outro titular faz o atual passar a cônjuge), **Editar morada**, **+ Adicionar pessoa**, **Apagar pessoa**.
- **Mapa:** cada família é um pin na cor da sua região, com o número de pessoas dentro; 🏠 e contorno dourado = aceita culto no lar. "Pintar regiões" desenha a mancha de cada região à volta das suas famílias. Ao lado, o quadro por região (famílias, pessoas, crianças, casas que aceitam culto no lar); tocar numa região abre os bairros dela e aproxima o mapa. "Só casas que aceitam culto no lar" mostra as candidatas a Pequeno Grupo. **📍 Localizar famílias** põe no mapa quem ainda não tem coordenadas: pelo código postal (geoapi.pt), senão pela morada, senão pelo centro do bairro (marcado como aproximado) — OpenStreetMap/Nominatim, grátis, 1 pedido por segundo.
- **Listas → Regiões e bairros:** cada região junta bairros e tem uma cor. Regiões iniciais (palpite para a Figueira da Foz): Centro, Buarcos e Norte, Margem Sul, Interior — tudo editável. A lista de bairros do formulário é a junção das regiões + "bairros sem região".
- **Listas → Nacionalidades:** a lista do formulário ("Outra" entra sozinha no fim); as escritas em "Outra" aparecem para acrescentar.
- **Famílias:** cada família é um bloco com as suas pessoas (parentesco, idade, tipo, WhatsApp), morada e mapa. Filtros por bairro, tipo e culto no lar.
- **Mover** uma pessoa para outra família ou para uma família nova (filho que casou, duas famílias que eram uma). Se sair o titular, o cônjuge (ou o adulto mais velho) passa a titular; família vazia é apagada.
- **CSV** com uma linha por pessoa: completo (Excel) e no formato do importador do admvc-site.

## Dados

Upstash Redis (plano gratuito), na mesma base do inscreva e do volta-admvc, com chaves `censo:`:

- `censo:familias`: id da família → morada, bairro, freguesia, coordenadas, culto no lar
- `censo:pessoas`: id da pessoa → dados pessoais, `familia_id`, `parentesco`, `is_family_admin`
- `censo:tel`: telemóvel (dígitos com indicativo) → id da pessoa. Um telemóvel, uma pessoa
- `censo:pre`: pré-cadastro da equipa, por telemóvel
- `censo:regioes`: regiões do mapa `[{ nome, cor, bairros }]`
- `censo:nacionalidades`: lista do formulário
- `censo:bairros`: lista do painel (até alguém gravar, usa a lista padrão de `api/censo.js`)
- `censo:cp:*`, `censo:rl:*`, `censo:tent:*`: cache de códigos postais e limites (expiram sozinhos)

Os campos têm os **nomes do modelo `Membro` do admvc-site** (`first_name`, `last_name`, `birthdate`, `neighborhood`, `parentesco`, …).

⚠️ O importador do admvc-site **recusa linhas sem e-mail**, e no censo o e-mail é opcional. Família e parentesco vão para `notes`, porque o importador não tem coluna para eles.

## Pôr no ar (Vercel)

1. `npx vercel login` (uma vez, abre o navegador) e depois, nesta pasta, `npx vercel` para criar o projeto.
2. Em *Settings → Environment Variables* (ou `npx vercel env add`), as três do `.env.local`:
   - `KV_REST_API_URL` e `KV_REST_API_TOKEN`: os mesmos do inscreva
   - `SENHA_ADMIN`: **sem ela o painel fica fechado na Vercel** (não há senha padrão em produção)
   - `GEOAPI_KEY` (opcional)
3. `npx vercel --prod` para publicar.
4. Acertar o `og:image` do `index.html` para o endereço absoluto (o WhatsApp precisa dele completo).
5. Abrir `https://<endereço>/telao` no computador do telão e carregar F11.
6. Testar com 3 ou 4 pessoas da equipa antes de anunciar.

O servidor local (`npm run dev`) e a Vercel usam a **mesma base** Upstash: o que se faz num aparece no outro.

## Cópia de segurança

Painel → **💾 Cópia de segurança** (barra das Famílias ou aba Listas) descarrega tudo num `.json`. **Restaurar** (aba Listas) substitui tudo pelo conteúdo do ficheiro e pede a palavra RESTAURAR. Recomenda-se uma cópia por semana durante o censo.

## Privacidade

`/privacidade` explica o que se guarda, para quê e a quem pedir para corrigir ou apagar (contacto da mídia, `MIDIA` em `src/dados.js`). Ligada no rodapé e na caixa de consentimento.

## Correr localmente

```powershell
$env:Path = "C:\Program Files\nodejs;$env:Path"
npm test                # testes da API, em memória
npm run dev:memoria     # http://localhost:3000 sem Upstash; dados em .censo-memoria.json (sobrevivem a reinícios)
npm run dev             # com o Upstash do .env.local (use CENSO_PREFIXO=teste-censo: para não misturar)
```
#   c e n s o - a d m v c  
 #   c e n s o - a d m v c  
 