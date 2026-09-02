/**
 * Abre a pergunta apontada pelo endereço.
 *
 * Cada item do FAQ é um `<details>` com id próprio, então um link direto para
 * uma resposta precisa abrir o item — senão a pessoa chega numa lista fechada
 * sem saber qual pergunta era.
 */
function openFaqFromHash(): void {
  const id = location.hash.slice(1);
  if (!id) return;
  const item = document.getElementById(id);
  if (!(item instanceof HTMLDetailsElement)) return;
  item.open = true;
  item.scrollIntoView({ block: "center" });
}

openFaqFromHash();
window.addEventListener("hashchange", openFaqFromHash);

// O navegador carrega este arquivo como módulo ES, com escopo próprio. O
// `export {}` diz o mesmo ao compilador: sem ele os nomes do topo entrariam no
// escopo global e colidiriam com os de outro módulo.
export {};
