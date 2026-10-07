import { Link } from 'react-router'
import { Icone } from '../components/ui/Icone'

// Página pública de Política de Privacidade (app.saiae.com.br/privacidade),
// exigida pela Play Store — hoje a ficha aponta pra política do iFood, o
// que viola a regra do Google. Escrita a partir do que o código realmente
// faz (ver comentários de cada seção), não é texto genérico de template.
// Aprovada pelo dono do produto em 2026-09-28 pra publicação — não é
// revisão jurídica formal (nenhum advogado revisou), decisão consciente
// dele mesmo assim.
//
// Sem tabela própria de "consentimento de cookies" ou analytics: o app não
// usa nenhum rastreador de terceiro (confirmado por busca no código,
// 2026-09-28) — não há seção de cookies além da nota informativa abaixo.

const DATA_VIGENCIA = '4 de outubro de 2026'

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-bold leading-7 text-mesa-text-primary font-mesa-display">{titulo}</h2>
      <div className="flex flex-col gap-3 text-[15px] leading-[1.6] text-mesa-text-secondary [&_strong]:text-mesa-text-primary [&_strong]:font-semibold">
        {children}
      </div>
    </section>
  )
}

function ItemLista({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <Icone nome="fiber_manual_record" size={6} className="mt-2.5 shrink-0 text-mesa-text-tertiary" />
      <span>{children}</span>
    </li>
  )
}

export function Privacidade() {
  return (
    <div className="min-h-dvh bg-mesa-bg-base">
      <header className="border-b border-mesa-border-subtle bg-mesa-surface">
        <div className="mx-auto flex max-w-[720px] items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/brand/saiae-icone-cor.svg" alt="" className="h-8 w-8" />
            <img
              src="/brand/saiae-wordmark-horizontal-preto.svg"
              alt="Sai aê"
              className="h-5 w-auto dark:hidden"
            />
            <img
              src="/brand/saiae-wordmark-horizontal.svg"
              alt="Sai aê"
              className="hidden h-5 w-auto dark:block"
            />
          </Link>
          <Link
            to="/login"
            className="text-sm font-medium text-mesa-text-secondary hover:text-mesa-text-primary"
          >
            Voltar
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-[720px] flex-col gap-10 px-6 py-10 pb-20">
        <div>
          <h1 className="text-[32px] font-bold leading-10 text-mesa-text-primary font-mesa-display">
            Política de Privacidade
          </h1>
          <p className="mt-2 text-sm text-mesa-text-tertiary">Última atualização: {DATA_VIGENCIA}</p>
        </div>

        <Secao titulo="1. Quem somos">
          <p>
            O Sai aê é um sistema de comanda digital para barracas de feira, food trucks, lanchonetes e
            operações de food service. Esta política explica quais dados coletamos, para quê e com quem
            compartilhamos, tanto no aplicativo (usado por donos de barraca e operadores) quanto no
            cardápio digital público (usado por clientes finais).
          </p>
          <p>
            Controlador dos dados: <strong>João Marcos</strong>, responsável pelo Sai aê. Contato para
            qualquer assunto de privacidade:{' '}
            <a href="mailto:contatosaiae@gmail.com" className="font-medium text-mesa-text-primary underline">
              contatosaiae@gmail.com
            </a>
            .
          </p>
        </Secao>

        <Secao titulo="2. Dados que coletamos do dono/operador da barraca">
          <p>Quem cria uma conta e opera uma barraca no Sai aê fornece, conforme o uso:</p>
          <ul className="flex flex-col gap-2">
            <ItemLista>
              <strong>Conta:</strong> e-mail e senha (usados só para autenticação, via Supabase Auth).
            </ItemLista>
            <ItemLista>
              <strong>Dados da barraca:</strong> nome, logo, imagem de capa e fotos/descrições do
              cardápio.
            </ItemLista>
            <ItemLista>
              <strong>Dados fiscais (opcional):</strong> CNPJ e token de integração com a FocusNFe, usados
              somente se o dono ativar a emissão de nota fiscal (NFC-e). O certificado digital fica sob
              custódia da FocusNFe, nunca do Sai aê.
            </ItemLista>
            <ItemLista>
              <strong>Pagamento online (opcional):</strong> token de integração com o Mercado Pago, usado
              somente se o dono ativar cobrança via Pix no cardápio digital.
            </ItemLista>
            <ItemLista>
              <strong>Taxas da maquininha:</strong> percentuais de taxa de débito/crédito informados pelo
              dono para cálculo interno de faturamento — dado privado, nunca exposto no cardápio público.
            </ItemLista>
            <ItemLista>
              <strong>Operação:</strong> pedidos, vendas, itens do cardápio, histórico, movimentações de
              caixa (abertura/fechamento, sangria/suprimento).
            </ItemLista>
            <ItemLista>
              <strong>Assinatura do Sai aê:</strong> processada pela Kirvano — não armazenamos dados de
              cartão; guardamos apenas o status da assinatura (ativa, em trial, etc.) e identificadores da
              transação.
            </ItemLista>
            <ItemLista>
              <strong>Impressora térmica (opcional):</strong> se o dono conectar uma impressora Bluetooth,
              guardamos só o endereço e o nome do dispositivo pareado, nunca dados adicionais do aparelho.
            </ItemLista>
          </ul>
        </Secao>

        <Secao titulo="3. Dados que coletamos do cliente final (cardápio digital)">
          <p>
            Quem acessa o cardápio digital público de uma barraca (link <code>/cardapio</code>) para
            navegar o menu ou montar um pedido <strong>não precisa informar nome, telefone ou e-mail</strong>.
            Coletamos apenas:
          </p>
          <ul className="flex flex-col gap-2">
            <ItemLista>Os itens escolhidos, a mesa (quando informada) e uma observação opcional do pedido.</ItemLista>
            <ItemLista>
              Quando o pagamento online (Pix) está habilitado pela barraca, o pagamento é processado
              diretamente pelo Mercado Pago. Como o Mercado Pago exige um e-mail de pagador para gerar a
              cobrança e o cardápio não coleta e-mail do cliente, usamos um e-mail-placeholder gerado por
              pedido (não é um e-mail real, não recebe nem envia nada).
            </ItemLista>
          </ul>
        </Secao>

        <Secao titulo="4. Dados de clientes de entrega (informados pela barraca)">
          <p>
            Quando a barraca usa o tipo de atendimento <strong>Entrega</strong>, quem lança o pedido
            informa os dados de quem vai receber. Esses dados são digitados pelo operador da barraca, não
            pelo cliente final dentro do app. Eles são:
          </p>
          <ul className="flex flex-col gap-2">
            <ItemLista>
              <strong>Nome e telefone</strong> do cliente.
            </ItemLista>
            <ItemLista>
              <strong>Endereço de entrega</strong>: rua, número, bairro e ponto de referência (opcional).
            </ItemLista>
          </ul>
          <p>Para que usamos esses dados, em nome da barraca:</p>
          <ul className="flex flex-col gap-2">
            <ItemLista>
              <strong>No pedido:</strong> os dados ficam copiados no próprio pedido, como registro da
              venda, e aparecem na comanda impressa para quem faz a entrega.
            </ItemLista>
            <ItemLista>
              <strong>No cadastro de clientes da barraca:</strong> nome, telefone e endereço são guardados
              para preencher a entrega automaticamente nos próximos pedidos do mesmo cliente. Cada barraca
              só enxerga os clientes cadastrados por ela; nenhuma barraca vê os clientes de outra.
            </ItemLista>
            <ItemLista>
              <strong>Chamar o entregador:</strong> o botão abre o WhatsApp do próprio aparelho com uma
              mensagem pronta (itens, nome, telefone e endereço do cliente) e <strong>sem número de
              destino</strong>. O operador escolhe o contato e envia. O Sai aê não envia mensagem, não se
              conecta ao WhatsApp e não recebe cópia dela.
            </ItemLista>
            <ItemLista>
              <strong>WhatsApp para avisar "pedido pronto" (opcional):</strong> o cliente pode informar o
              número ao fazer o pedido (na barraca ou no cardápio digital). Ele serve <strong>somente</strong>{' '}
              para a barraca avisar que aquele pedido ficou pronto, abrindo o WhatsApp do aparelho dela. Não
              entra no cadastro de clientes de entrega, não é usado para ofertas e fica guardado junto do
              pedido, sendo apagado quando o pedido é apagado (Apagar período ou exclusão da barraca).
            </ItemLista>
            <ItemLista>
              <strong>Contato comercial (opcional):</strong> no cardápio digital, quem pede entrega pode
              marcar, em uma caixa separada, que aceita receber ofertas e novidades da loja por WhatsApp.
              Sem essa marcação os dados servem só para entregar o pedido. A barraca pode exportar uma
              lista dos clientes que aceitaram, para usar no próprio contato; o Sai aê não envia
              mensagens em massa. Quem aceitou pode revogar a qualquer momento pedindo à barraca, e o dono
              da barraca pode excluir o cadastro do cliente em Ajustes, na seção "Clientes de entrega".
            </ItemLista>
            <ItemLista>
              <strong>Link do entregador:</strong> a barraca pode enviar ao entregador um link (por
              exemplo pelo WhatsApp) que mostra, sem login, os itens do pedido e o nome, telefone e
              endereço de entrega do cliente, para o entregador confirmar a entrega e a forma de
              pagamento. O link é único e difícil de adivinhar, deixa de mostrar esses dados assim que a
              entrega é confirmada e expira em 24 horas. Não há cadastro do entregador.
            </ItemLista>
          </ul>
          <p>
            A barraca é quem decide coletar esses dados e para que usá-los; o Sai aê só os armazena e
            processa para a barraca poder operar. Antes de sincronizar com o servidor, o pedido (inclusive
            esses dados) fica guardado temporariamente no aparelho para funcionar sem internet.
          </p>
          <p>
            <strong>Excluir:</strong> o dono da barraca pode excluir o cadastro de um cliente em Ajustes,
            na seção "Clientes de entrega". Isso apaga o cadastro; os pedidos já feitos continuam no
            Histórico com os dados da entrega, e só são apagados pelo "Apagar período" ou ao excluir a
            barraca (ver "Retenção de dados"). O cliente final que quiser corrigir ou apagar os próprios
            dados pode pedir à barraca ou diretamente a nós pelo e-mail de contato abaixo.
          </p>
        </Secao>

        <Secao titulo="5. Biometria (Face ID / Touch ID / biometria do Android)">
          <p>
            O desbloqueio por biometria é um atalho de reentrada no mesmo aparelho — não é um método de
            login novo nem um cadastro de dados biométricos. A credencial (WebAuthn) fica armazenada
            apenas no próprio aparelho, gerada e verificada pelo hardware do dispositivo (Secure
            Enclave/TPM); <strong>o Sai aê nunca recebe nem armazena dado biométrico em nenhum servidor</strong>.
          </p>
        </Secao>

        <Secao titulo="6. Reportar um problema">
          <p>
            Ao usar o formulário "Ajuda e suporte" para reportar um bug, enviamos por e-mail à nossa
            equipe: a descrição do problema, seu e-mail de cadastro, o nome da barraca e informações
            técnicas do navegador/aparelho (user agent) — usados só para diagnosticar o problema relatado.
          </p>
        </Secao>

        <Secao titulo="7. Com quem compartilhamos dados">
          <p>Usamos os seguintes prestadores de serviço para operar o Sai aê. Nenhum deles usa seus dados para fins próprios de publicidade:</p>
          <ul className="flex flex-col gap-2">
            <ItemLista><strong>Supabase</strong> — banco de dados, autenticação e sincronização em tempo real.</ItemLista>
            <ItemLista><strong>Cloudflare</strong> — hospedagem e entrega do aplicativo web.</ItemLista>
            <ItemLista><strong>Resend</strong> — envio de e-mails transacionais (confirmação de cadastro, redefinição de senha, reporte de bug).</ItemLista>
            <ItemLista><strong>Mercado Pago</strong> — processamento de pagamentos Pix no cardápio digital (quando habilitado).</ItemLista>
            <ItemLista><strong>FocusNFe</strong> — emissão de nota fiscal eletrônica (quando habilitado pelo dono da barraca).</ItemLista>
            <ItemLista><strong>Kirvano</strong> — processamento da cobrança de assinatura do Sai aê.</ItemLista>
            <ItemLista><strong>Google Fonts</strong> — carregamento das fontes usadas na interface.</ItemLista>
          </ul>
          <p>
            Não usamos ferramentas de analytics, rastreamento de comportamento ou publicidade de
            terceiros — nenhum dado de uso é compartilhado para fins de marketing.
          </p>
        </Secao>

        <Secao titulo="8. Segurança">
          <p>
            Dados sensíveis (senhas de acesso, tokens de integração fiscal e de pagamento) ficam
            protegidos por controle de acesso a nível de linha (RLS) no banco de dados, sem consulta
            direta pelo cliente — só através de funções controladas no servidor. A comunicação entre o
            aplicativo e nossos servidores é sempre criptografada (HTTPS/TLS).
          </p>
        </Secao>

        <Secao titulo="9. Retenção de dados">
          <p>
            Mantemos os dados da sua conta e da sua barraca enquanto ela existir. Histórico de pedidos
            pode ser apagado manualmente pelo dono da barraca (função "Apagar período", em Histórico).
            Ao excluir uma barraca, todos os dados associados a ela (pedidos, cardápio, histórico, senha
            administrativa, clientes de entrega) são apagados permanentemente.
          </p>
          <p>
            O cadastro de clientes de entrega fica guardado enquanto a barraca existir ou até o dono
            excluí-lo em Ajustes. Os dados de entrega copiados em cada pedido ficam no Histórico até a
            barraca apagar o período correspondente.
          </p>
        </Secao>

        <Secao titulo="10. Seus direitos (LGPD)">
          <p>
            Você pode solicitar, a qualquer momento e gratuitamente, através do e-mail{' '}
            <a href="mailto:contatosaiae@gmail.com" className="font-medium text-mesa-text-primary underline">
              contatosaiae@gmail.com
            </a>
            :
          </p>
          <ul className="flex flex-col gap-2">
            <ItemLista>Confirmação da existência de tratamento e acesso aos seus dados.</ItemLista>
            <ItemLista>Correção de dados incompletos, inexatos ou desatualizados.</ItemLista>
            <ItemLista>Exclusão dos seus dados pessoais — ver detalhes na página de{' '}
              <Link to="/excluir-conta" className="font-medium text-mesa-text-primary underline">
                exclusão de conta
              </Link>
              .
            </ItemLista>
            <ItemLista>Portabilidade dos dados a outro fornecedor de serviço.</ItemLista>
            <ItemLista>Revogação do consentimento, quando aplicável.</ItemLista>
          </ul>
        </Secao>

        <Secao titulo="11. Alterações nesta política">
          <p>
            Podemos atualizar esta política conforme o Sai aê ganha novos recursos. Mudanças relevantes
            serão comunicadas por e-mail ou aviso no aplicativo. A data no topo desta página sempre
            indica a versão mais recente.
          </p>
        </Secao>

        <Secao titulo="12. Contato">
          <p>
            Dúvidas sobre esta política ou sobre seus dados:{' '}
            <a href="mailto:contatosaiae@gmail.com" className="font-medium text-mesa-text-primary underline">
              contatosaiae@gmail.com
            </a>
            .
          </p>
        </Secao>
      </main>
    </div>
  )
}
