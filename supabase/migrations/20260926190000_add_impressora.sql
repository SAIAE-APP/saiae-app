alter table barracas
  add column impressora_habilitada boolean not null default false,
  add column impressora_endereco text,
  add column impressora_nome text,
  add column impressora_largura_papel text not null default '80mm'
    check (impressora_largura_papel in ('58mm', '80mm'));
