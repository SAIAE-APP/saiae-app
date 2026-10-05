import { Link } from 'react-router'
import { Icone } from '../components/ui/Icone'
import { Card } from '../components/ui/Card'

// Página pública de Exclusão de conta (app.saiae.com.br/excluir-conta) —
// exigida pelo Google pra apps que permitem criar conta. Desde
// 2026-09-28 existe exclusão self-service in-app de verdade (Ajustes >
// Conta > "Excluir minha conta", edge function `excluir-conta` +
// RPC `excluir_dados_conta`) — essa página lidera com esse caminho, e
// mantém o e-mail como alternativa pra quem não consegue acessar o app
// (perdeu a senha, não tem mais o aparelho, etc.).

const ASSUNTO_EMAIL = 'Excluir minha conta Sai aê'
const LINK_EMAIL = `mailto:contatosaiae@gmail.com?subject=${encodeURIComponent(ASSUNTO_EMAIL)}`

function ItemLista({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <Icone nome="fiber_manual_record" size={6} className="mt-2.5 shrink-0 text-mesa-text-tertiary" />
      <span>{children}</span>
    </li>
  )
}

export function ExcluirConta() {
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

      <main className="mx-auto flex max-w-[720px] flex-col gap-8 px-6 py-10 pb-20">
        <div>
          <h1 className="text-[32px] font-bold leading-10 text-mesa-text-primary font-mesa-display">
            Excluir sua conta
          </h1>
          <p className="mt-2 text-[15px] leading-[1.6] text-mesa-text-secondary">
            Você pode pedir a exclusão da sua conta e de todos os seus dados no Sai aê a qualquer
            momento.
          </p>
        </div>

        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-mesa-text-primary font-mesa-display">
            Direto pelo app (mais rápido)
          </h2>
          <p className="text-[15px] leading-[1.6] text-mesa-text-secondary">
            Abra o Sai aê, vá em <strong className="font-semibold text-mesa-text-primary">Ajustes → Conta</strong>,
            role até <strong className="font-semibold text-mesa-text-primary">Excluir minha conta</strong> e
            confirme digitando <strong className="font-semibold text-mesa-text-primary">EXCLUIR</strong>. A
            exclusão acontece na hora — login e dados apagados imediatamente, sem espera.
          </p>
        </Card>

        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-mesa-text-primary font-mesa-display">
            Sem acesso ao app? Peça por e-mail
          </h2>
          <p className="text-[15px] leading-[1.6] text-mesa-text-secondary">
            Se você perdeu a senha ou não tem mais o aparelho, envie um e-mail para{' '}
            <a href={LINK_EMAIL} className="font-medium text-mesa-text-primary underline">
              contatosaiae@gmail.com
            </a>{' '}
            a partir do e-mail cadastrado na sua conta, pedindo a exclusão. Respondemos e confirmamos a
            exclusão em até <strong className="font-semibold text-mesa-text-primary">7 dias úteis</strong>.
          </p>
          <a
            href={LINK_EMAIL}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-mesa-btn bg-mesa-orange-500 px-5 text-sm font-medium text-mesa-neutral-900 hover:bg-mesa-orange-400"
          >
            <Icone nome="mail" size={16} />
            Pedir exclusão por e-mail
          </a>
        </Card>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-mesa-text-primary font-mesa-display">O que é apagado</h2>
          <ul className="flex flex-col gap-2 text-[15px] leading-[1.6] text-mesa-text-secondary">
            <ItemLista>Sua conta de acesso (e-mail e senha).</ItemLista>
            <ItemLista>
              Toda barraca da qual você é dono: cardápio, pedidos (inclusive os dados de entrega),
              clientes de entrega cadastrados, histórico, caixa e configurações.
            </ItemLista>
            <ItemLista>
              Tokens de integração associados (fiscal, pagamento online) e a credencial de biometria
              salva no seu aparelho.
            </ItemLista>
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-mesa-text-primary font-mesa-display">Antes de pedir, saiba</h2>
          <ul className="flex flex-col gap-2 text-[15px] leading-[1.6] text-mesa-text-secondary">
            <ItemLista>
              Se você é <strong className="font-semibold text-mesa-text-primary">funcionário</strong> de
              uma barraca (não dono), ou <strong className="font-semibold text-mesa-text-primary">dono
              junto com outra pessoa</strong>, sua conta é excluída, mas a barraca continua existindo —
              gerida por quem mais tem acesso a ela. Só apagamos uma barraca inteira quando você é o
              único dono dela.
            </ItemLista>
            <ItemLista>
              Se você tem uma assinatura ativa via Kirvano, cancele-a separadamente pelo link de gestão
              que você recebeu por e-mail, ou nos avise que ajudamos.
            </ItemLista>
            <ItemLista>A exclusão é permanente e não pode ser desfeita.</ItemLista>
          </ul>
        </section>

        <p className="text-sm text-mesa-text-tertiary">
          Veja também nossa{' '}
          <Link to="/privacidade" className="font-medium text-mesa-text-secondary underline">
            Política de Privacidade
          </Link>
          .
        </p>
      </main>
    </div>
  )
}
